"""Validate marker metadata needed for offline BrainGame replay.

This check is intentionally independent from the EEG classifier.  It verifies
that a recorded session contains enough immutable stimulus metadata to replay
the same target mapping and geometry without connecting acquisition hardware.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Iterable


def read_markers(session_dir: Path) -> list[dict]:
    path = session_dir / "markers.jsonl"
    if not path.is_file():
        raise FileNotFoundError(f"markers.jsonl not found: {session_dir}")
    markers: list[dict] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"invalid marker JSON at line {line_number}") from exc
        if not isinstance(value, dict):
            raise ValueError(f"marker at line {line_number} is not an object")
        markers.append(value)
    return markers


def _finite_number(value: object, field: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"marker field {field} is not numeric") from exc
    if not math.isfinite(number):
        raise ValueError(f"marker field {field} is not finite")
    return number


def _validate_targets(marker: dict) -> None:
    targets = marker.get("targets")
    if not isinstance(targets, list) or not targets:
        raise ValueError("stimulus_start marker has no targets")
    static_control = (marker.get("trialKind") == "timing_diagnostic"
                      and marker.get("comparisonProtocol") in ("central-solid-evocation-v1", "central-appearance-comparison-v1", "central-cardface-comparison-v1", "central-three-form-comparison-v1", "central-short-fixation-comparison-v1")
                      and marker.get("condition") == "static")
    if static_control and (len(targets) != 1 or marker.get("modulationAmplitude") != 0
                           or marker.get("activeTargetIds") != []):
        raise ValueError("static control must have one unmodulated inactive target")
    ids: set[str] = set()
    frequencies: list[float] = []
    for target in targets:
        if not isinstance(target, dict):
            raise ValueError("stimulus target is not an object")
        target_id = str(target.get("id", ""))
        if not target_id or target_id in ids:
            raise ValueError("stimulus target ids must be non-empty and unique")
        ids.add(target_id)
        frequency = _finite_number(target.get("frequencyHz"), "targets.frequencyHz")
        if not (frequency == 0 if static_control else 0 < frequency < 100):
            raise ValueError("stimulus target frequency is outside 0–100 Hz")
        frequencies.append(frequency)
        for field in ("phaseRad", "x", "y"):
            number = _finite_number(target.get(field), f"targets.{field}")
            if field in ("x", "y") and not 0 <= number <= 1:
                raise ValueError(f"stimulus target {field} must be between 0 and 1")
    if len({round(frequency, 6) for frequency in frequencies}) != len(frequencies):
        raise ValueError("stimulus target frequencies must be unique")


def validate_markers(markers: Iterable[dict]) -> dict[str, int]:
    """Validate marker ordering and return a compact replay summary."""
    starts = [marker for marker in markers if marker.get("markerType") == "stimulus_start"]
    ends = [marker for marker in markers if marker.get("markerType") == "stimulus_end"]
    if not starts:
        raise ValueError("no stimulus_start markers found")
    previous_sample = -1
    start_ids: set[str] = set()
    for marker in starts:
        trial_id = str(marker.get("trialId", ""))
        if not trial_id or trial_id in start_ids:
            raise ValueError("stimulus_start trialId values must be unique")
        start_ids.add(trial_id)
        sample_number = _finite_number(marker.get("markerSampleIndex"), "markerSampleIndex")
        if not sample_number.is_integer():
            raise ValueError("markerSampleIndex must be an integer")
        sample_index = int(sample_number)
        if sample_index < 0 or sample_index < previous_sample:
            raise ValueError("stimulus_start markerSampleIndex values must be monotonic")
        previous_sample = sample_index
        _validate_targets(marker)
        if marker.get("trialKind") == "teaching":
            targets = marker["targets"]
            if not 2 <= len(targets) <= 4:
                raise ValueError("teaching markers must contain 2–4 targets")
            geometry = marker.get("stimulusGeometry") or {}
            if geometry.get("version") not in ("teaching-geometry-v3", "teaching-geometry-v4", "teaching-geometry-v5"):
                raise ValueError("teaching marker has unexpected geometry version")
            if geometry.get("version") in ("teaching-geometry-v4", "teaching-geometry-v5"):
                expected_layout = "grid-2x2" if geometry.get("version") == "teaching-geometry-v4" and len(targets) == 4 else "horizontal-single-row"
                if marker.get("teachingMode") != "principle" or geometry.get("targetSize") != "teaching-fill":
                    raise ValueError("expanded teaching geometry is only valid for principle demonstrations")
            else:
                expected_layout = "horizontal-single-row"
            if geometry.get("referenceVisible") is not False or geometry.get("layout") != expected_layout:
                raise ValueError("teaching marker must record hidden reference and matching layout")
    end_ids = {str(marker.get("trialId", "")) for marker in ends}
    if not start_ids.issubset(end_ids):
        raise ValueError("some stimulus_start markers have no matching stimulus_end")
    return {"starts": len(starts), "ends": len(ends), "teaching": sum(marker.get("trialKind") == "teaching" for marker in starts)}


def validate_session(session_dir: Path) -> dict[str, int]:
    return validate_markers(read_markers(session_dir))


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--session", type=Path, required=True, help="session directory containing markers.jsonl")
    args = parser.parse_args(list(argv) if argv is not None else None)
    summary = validate_session(args.session)
    print(f"valid session markers: {summary['starts']} starts, {summary['ends']} ends, {summary['teaching']} teaching")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

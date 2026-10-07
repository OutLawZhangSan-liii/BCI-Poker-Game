"""Analyze marker-aligned isolated SSVEP diagnostic trials.

Only O1/O2/P3/P4 are loaded.  Each channel is independently de-meaned;
unused electrodes are never used as a reference.  Fundamental-frequency SNR
is estimated from a 2-second Welch spectrum, whose 0.5 Hz bins place both
7.5 Hz and 16.5 Hz exactly on FFT bins.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from functools import lru_cache

from scipy.signal import firwin, lfilter, welch

from .inspect_eeg import ANALYSIS_LEADS, load_session, resolve_session


def _read_jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _frequency_snr_db(frequencies: np.ndarray, spectrum: np.ndarray, target_hz: float) -> np.ndarray:
    target_index = int(np.argmin(np.abs(frequencies - target_hz)))
    noise_indices = [target_index + offset for offset in (-2, -1, 1, 2)
                     if 0 <= target_index + offset < len(frequencies)]
    target_power = np.maximum(spectrum[target_index], 1e-20)
    noise_power = np.maximum(np.mean(spectrum[noise_indices], axis=0), 1e-20)
    return 10 * np.log10(target_power / noise_power)


def _notch50(signal: np.ndarray, sample_rate: float) -> np.ndarray:
    if sample_rate <= 110:
        return signal
    omega = 2 * np.pi * 50 / sample_rate
    radius = 0.985
    cosine = np.cos(omega)
    return lfilter([1, -2 * cosine, 1], [1, -2 * radius * cosine, radius * radius], signal)


def _bandpass(signal: np.ndarray, sample_rate: float, low_hz: float, high_hz: float) -> np.ndarray:
    center = np.sqrt(low_hz * high_hz)
    quality = center / max(0.1, high_hz - low_hz)
    omega = 2 * np.pi * center / sample_rate
    alpha = np.sin(omega) / (2 * quality)
    a0 = 1 + alpha
    return lfilter(
        [alpha / a0, 0, -alpha / a0],
        [1, -2 * np.cos(omega) / a0, (1 - alpha) / a0],
        signal,
    )


def _reference_score(signal: np.ndarray, frequency_hz: float, sample_rate: float, harmonics: int = 3) -> float:
    centered = signal - np.mean(signal)
    energy = float(centered @ centered)
    if energy <= 1e-12:
        return 0.0
    sample = np.arange(len(signal))
    score = 0.0
    for harmonic in range(1, harmonics + 1):
        angle = 2 * np.pi * frequency_hz * harmonic * sample / sample_rate
        sine = float(centered @ np.sin(angle))
        cosine = float(centered @ np.cos(angle))
        score += (sine * sine + cosine * cosine) / (energy * len(signal))
    return score


def _prototype_scores(window: np.ndarray, sample_rate: float, target_frequencies: list[float], harmonics: int = 3) -> np.ndarray:
    """Numerically reproduce renderer fbcca.ts for an offline window."""
    banks = ((6.0, 45.0), (14.0, 45.0), (22.0, 45.0))
    centered = window - np.mean(window, axis=0, keepdims=True)
    prepared = np.column_stack([_notch50(centered[:, channel], sample_rate)
                                for channel in range(centered.shape[1])])
    scores = np.zeros(len(target_frequencies))
    for target_index, target in enumerate(target_frequencies):
        for bank_index, (low_hz, high_hz) in enumerate(banks):
            weight = 1 / (bank_index + 1) ** 1.25
            for channel in range(prepared.shape[1]):
                filtered = _bandpass(prepared[:, channel], sample_rate, low_hz, high_hz)
                scores[target_index] += weight * _reference_score(filtered, target, sample_rate, harmonics)
        scores[target_index] /= prepared.shape[1]
    return scores


def _cca_correlation(eeg: np.ndarray, references: np.ndarray) -> float:
    eeg = eeg - np.mean(eeg, axis=0, keepdims=True)
    references = references - np.mean(references, axis=0, keepdims=True)
    covariance_x = eeg.T @ eeg / max(1, len(eeg) - 1)
    covariance_y = references.T @ references / max(1, len(references) - 1)
    cross = eeg.T @ references / max(1, len(eeg) - 1)
    covariance_x += np.eye(covariance_x.shape[0]) * max(np.trace(covariance_x) / covariance_x.shape[0] * 1e-6, 1e-9)
    covariance_y += np.eye(covariance_y.shape[0]) * max(np.trace(covariance_y) / covariance_y.shape[0] * 1e-6, 1e-9)
    chol_x = np.linalg.cholesky(covariance_x)
    chol_y = np.linalg.cholesky(covariance_y)
    whitened = np.linalg.solve(chol_x, cross)
    whitened = np.linalg.solve(chol_y, whitened.T).T
    return float(np.clip(np.linalg.svd(whitened, compute_uv=False)[0], 0, 1))


def _true_fbcca_scores(
    window: np.ndarray,
    sample_rate: float,
    target_frequencies: list[float],
    harmonics: int = 2,
    banks: tuple[tuple[float, float], ...] = ((6.0, 45.0), (14.0, 45.0)),
) -> np.ndarray:
    centered = window - np.mean(window, axis=0, keepdims=True)
    prepared = np.column_stack([_notch50(centered[:, channel], sample_rate)
                                for channel in range(centered.shape[1])])
    sample = np.arange(len(window))
    references = []
    for target in target_frequencies:
        columns = []
        for harmonic in range(1, harmonics + 1):
            angle = 2 * np.pi * target * harmonic * sample / sample_rate
            columns.extend((np.sin(angle), np.cos(angle)))
        references.append(np.column_stack(columns))
    scores = np.zeros(len(target_frequencies))
    for bank_index, (low_hz, high_hz) in enumerate(banks):
        filtered = np.column_stack([_bandpass(prepared[:, channel], sample_rate, low_hz, high_hz)
                                    for channel in range(prepared.shape[1])])
        weight = 1 / (bank_index + 1) ** 1.25
        for target_index, reference in enumerate(references):
            correlation = _cca_correlation(filtered, reference)
            scores[target_index] += weight * correlation * correlation
    return scores


@lru_cache(maxsize=16)
def _fir_taps(sample_rate: float, low_hz: float, high_hz: float, length: int = 257) -> np.ndarray:
    return firwin(length, [low_hz, high_hz], pass_zero=False, fs=sample_rate, window="hamming")


def _true_fbcca_fir_scores(
    window: np.ndarray,
    sample_rate: float,
    target_frequencies: list[float],
    harmonics: int = 2,
    banks: tuple[tuple[float, float], ...] = ((6.0, 45.0),),
) -> np.ndarray:
    centered = window - np.mean(window, axis=0, keepdims=True)
    sample = np.arange(len(window))
    references = []
    for target in target_frequencies:
        columns = []
        for harmonic in range(1, harmonics + 1):
            angle = 2 * np.pi * target * harmonic * sample / sample_rate
            columns.extend((np.sin(angle), np.cos(angle)))
        references.append(np.column_stack(columns))
    scores = np.zeros(len(target_frequencies))
    for bank_index, (low_hz, high_hz) in enumerate(banks):
        taps = _fir_taps(sample_rate, low_hz, high_hz)
        filtered = lfilter(taps, [1.0], centered, axis=0)[len(taps) - 1:]
        weight = 1 / (bank_index + 1) ** 1.25
        for target_index, reference in enumerate(references):
            correlation = _cca_correlation(filtered, reference[len(taps) - 1:])
            scores[target_index] += weight * correlation * correlation
    return scores


def _normalized_fbcca_fir_scores(
    window: np.ndarray,
    sample_rate: float,
    target_frequencies: list[float],
    harmonics: int = 2,
    banks: tuple[tuple[float, float], ...] = ((6.0, 45.0),),
) -> np.ndarray:
    scores = np.zeros(len(target_frequencies))
    for target_index, target in enumerate(target_frequencies):
        comparison_frequencies = [target, target - 1.0, target - 0.5, target + 0.5, target + 1.0]
        raw = _true_fbcca_fir_scores(window, sample_rate, comparison_frequencies, harmonics, banks)
        scores[target_index] = max(raw[0], 1e-12) / max(float(np.mean(raw[1:])), 1e-12)
    return scores


def analyze(session_dir: Path, onset_seconds: float = 0.5, end_seconds: float = 4.0) -> int:
    metadata = json.loads((session_dir / "session.json").read_text(encoding="utf-8"))
    raw, sample_rate, _ = load_session(session_dir, seconds=0)
    starts = [marker for marker in _read_jsonl(session_dir / "markers.jsonl")
              if marker.get("markerType") == "stimulus_start"
              and marker.get("trialKind") == "isolated_diagnostic"]
    starts.sort(key=lambda marker: int(marker["markerSampleIndex"]))
    if not starts:
        raise ValueError("no isolated_diagnostic stimulus_start markers found")

    decisions_by_trial: dict[str, list[dict]] = defaultdict(list)
    for decision in _read_jsonl(session_dir / "decisions.jsonl"):
        decisions_by_trial[str(decision.get("trialId"))].append(decision)

    trial_rows: list[dict] = []
    for trial_number, marker in enumerate(starts, 1):
        label = int(marker["cuedTargetIndex"])
        targets = marker["targets"]
        target_frequencies = [float(target["frequencyHz"]) for target in targets]
        start = int(marker["markerSampleIndex"]) + int(round(onset_seconds * sample_rate))
        stop = int(marker["markerSampleIndex"]) + int(round(end_seconds * sample_rate))
        segment = raw[start:stop]
        if len(segment) != stop - start:
            raise ValueError(f"trial {trial_number} is truncated")
        segment = segment - np.mean(segment, axis=0, keepdims=True)
        frequencies, spectrum = welch(
            segment,
            fs=sample_rate,
            window="hann",
            nperseg=int(round(2 * sample_rate)),
            noverlap=int(round(sample_rate)),
            detrend="constant",
            axis=0,
            scaling="density",
        )
        snr = np.vstack([_frequency_snr_db(frequencies, spectrum, frequency)
                         for frequency in target_frequencies])
        mean_snr = np.mean(snr, axis=1)
        predicted = int(np.argmax(mean_snr))
        accepted = [decision for decision in decisions_by_trial[str(marker["trialId"])]
                    if not decision.get("rejected") and decision.get("candidateIndex") is not None]
        accepted_counts = Counter(int(decision["candidateIndex"]) for decision in accepted)
        prototype_scores = {harmonics: [] for harmonics in (1, 2, 3)}
        window_samples = int(round(sample_rate))
        hop_samples = int(round(0.25 * sample_rate))
        trial_origin = int(marker["markerSampleIndex"])
        for window_start in range(0, int(round(3.0 * sample_rate)), hop_samples):
            window = raw[trial_origin + window_start:trial_origin + window_start + window_samples]
            if len(window) == window_samples:
                for harmonics in prototype_scores:
                    prototype_scores[harmonics].append(_prototype_scores(window, sample_rate, target_frequencies, harmonics))
        trial_rows.append({
            "trial": trial_number,
            "label": label,
            "frequencies": target_frequencies,
            "snr": snr,
            "mean_snr": mean_snr,
            "predicted": predicted,
            "accepted_counts": accepted_counts,
            "prototype_scores": {harmonics: np.vstack(scores) for harmonics, scores in prototype_scores.items()},
        })

    print(f"session: {session_dir}")
    print(f"status: {metadata.get('status')}; samples/channel: {len(raw)}; sample rate: {sample_rate:g} Hz")
    print("preprocess: O1/O2/P3/P4; per-channel mean removal; rereference OFF")
    print(f"analysis window: {onset_seconds:.1f}-{end_seconds:.1f} s after actual stimulus first-frame marker")
    print(f"isolated trials: {len(trial_rows)} (labels: {Counter(row['label'] for row in trial_rows)})")
    print("\ntrial target SNR (dB; channel mean, then O1/O2/P3/P4):")
    for row in trial_rows:
        active = row["label"]
        inactive = 1 - active
        active_values = row["snr"][active]
        inactive_values = row["snr"][inactive]
        active_text = "/".join(f"{value:+.2f}" for value in active_values)
        counts = ",".join(f"{index}:{count}" for index, count in sorted(row["accepted_counts"].items())) or "none"
        print(
            f"  {row['trial']}: cue={active} ({row['frequencies'][active]:.1f} Hz) "
            f"active={np.mean(active_values):+.2f} [{active_text}] "
            f"other={row['mean_snr'][inactive]:+.2f} predicted={row['predicted']} "
            f"FBCCA accepted={counts}"
        )

    print("\ncondition means by channel (active condition minus inactive condition):")
    for target_index, frequency in enumerate(trial_rows[0]["frequencies"]):
        active_rows = np.vstack([row["snr"][target_index] for row in trial_rows if row["label"] == target_index])
        inactive_rows = np.vstack([row["snr"][target_index] for row in trial_rows if row["label"] != target_index])
        active_mean = np.mean(active_rows, axis=0)
        inactive_mean = np.mean(inactive_rows, axis=0)
        contrast = active_mean - inactive_mean
        print(f"  {frequency:.1f} Hz")
        for lead_index, lead in enumerate(ANALYSIS_LEADS):
            print(f"    {lead}: active={active_mean[lead_index]:+.2f} dB, inactive={inactive_mean[lead_index]:+.2f} dB, contrast={contrast[lead_index]:+.2f} dB")
        print(f"    mean contrast={np.mean(contrast):+.2f} dB")

    spectral_correct = sum(row["predicted"] == row["label"] for row in trial_rows)
    all_accepted = Counter()
    for row in trial_rows:
        all_accepted.update(row["accepted_counts"])
    print(f"\nsimple spectral winner accuracy: {spectral_correct}/{len(trial_rows)} ({100 * spectral_correct / len(trial_rows):.1f}%)")
    print(f"FBCCA accepted decisions by candidate: {dict(sorted(all_accepted.items()))}")
    print("\noffline reproduction of current 1-second fbcca-prototype windows:")
    for harmonics in (1, 2, 3):
        prototype_correct = 0
        prototype_winners = Counter()
        for row in trial_rows:
            scores = row["prototype_scores"][harmonics]
            winners = np.argmax(scores, axis=1)
            prototype_correct += int(np.count_nonzero(winners == row["label"]))
            prototype_winners.update(int(winner) for winner in winners)
            if harmonics == 3:
                mean_scores = np.mean(scores, axis=0)
                print(f"  trial {row['trial']} cue={row['label']}: score0={mean_scores[0]:.6f}, score1={mean_scores[1]:.6f}, winners={Counter(winners)}")
        prototype_total = sum(len(row["prototype_scores"][harmonics]) for row in trial_rows)
        print(f"  harmonics={harmonics}: window accuracy={prototype_correct}/{prototype_total} ({100 * prototype_correct / prototype_total:.1f}%); winners={dict(sorted(prototype_winners.items()))}")

    print("\ntrue multichannel CCA candidates (2 harmonics; 50 Hz-adjacent third harmonic excluded globally):")
    variants = {
        "IIR CCA 6-45": ("iir", ((6.0, 45.0),)),
        "IIR FBCCA 6-45 + 14-45": ("iir", ((6.0, 45.0), (14.0, 45.0))),
        "FIR CCA 6-45": ("fir", ((6.0, 45.0),)),
        "FIR FBCCA 6-45 + 14-45": ("fir", ((6.0, 45.0), (14.0, 45.0))),
        "FIR normalized CCA 6-45": ("fir_norm", ((6.0, 45.0),)),
        "FIR normalized FBCCA 6-45 + 14-45": ("fir_norm", ((6.0, 45.0), (14.0, 45.0))),
    }
    for window_seconds in (1.0, 1.5, 2.0, 2.5, 3.0, 3.5):
        window_samples = int(round(window_seconds * sample_rate))
        hop_samples = int(round(0.25 * sample_rate))
        analysis_onset_samples = int(round(0.5 * sample_rate))
        for variant_name, (filter_kind, banks) in variants.items():
            correct = 0
            trial_correct = 0
            winners = Counter()
            margins = []
            total = 0
            for row, marker in zip(trial_rows, starts):
                trial_origin = int(marker["markerSampleIndex"])
                trial_scores = []
                latest_start = int(round(4.0 * sample_rate)) - window_samples
                for window_start in range(analysis_onset_samples, latest_start + 1, hop_samples):
                    window = raw[trial_origin + window_start:trial_origin + window_start + window_samples]
                    scores = (_normalized_fbcca_fir_scores(window, sample_rate, row["frequencies"], banks=banks)
                              if filter_kind == "fir_norm" else
                              _true_fbcca_fir_scores(window, sample_rate, row["frequencies"], banks=banks)
                              if filter_kind == "fir" else
                              _true_fbcca_scores(window, sample_rate, row["frequencies"], banks=banks))
                    winner = int(np.argmax(scores))
                    winners[winner] += 1
                    correct += int(winner == row["label"])
                    total += 1
                    margins.append((scores[winner] - scores[1 - winner]) / max(scores[winner], 1e-12))
                    trial_scores.append(scores)
                trial_correct += int(np.argmax(np.mean(trial_scores, axis=0)) == row["label"])
            print(f"  {window_seconds:.1f}s {variant_name}: window_accuracy={correct}/{total} ({100 * correct / total:.1f}%), trial_accuracy={trial_correct}/{len(trial_rows)}, winners={dict(sorted(winners.items()))}, median_margin={np.median(margins):.3f}")

    print("\nonline vote replay (FIR normalized FBCCA; confidence>=0.52, margin>=0.08, 2 equal votes):")
    for window_seconds in (2.0, 2.5, 3.0, 3.5):
        window_samples = int(round(window_seconds * sample_rate))
        hop_samples = int(round(0.25 * sample_rate))
        correct_trials = 0
        rejected_trials = 0
        output_counts = Counter()
        details = []
        for row, marker in zip(trial_rows, starts):
            trial_origin = int(marker["markerSampleIndex"])
            votes: list[int] = []
            accepted: list[int] = []
            for window_start in range(0, int(round(4.0 * sample_rate)) - window_samples + 1, hop_samples):
                window = raw[trial_origin + window_start:trial_origin + window_start + window_samples]
                scores = _normalized_fbcca_fir_scores(window, sample_rate, row["frequencies"], banks=((6.0, 45.0), (14.0, 45.0)))
                winner = int(np.argmax(scores))
                confidence = scores[winner] / max(float(np.sum(scores)), 1e-12)
                margin = (scores[winner] - scores[1 - winner]) / max(scores[winner], 1e-12)
                quality_vote = winner if confidence >= 0.52 and margin >= 0.08 else -1
                votes.append(quality_vote)
                votes = votes[-2:]
                if len(votes) == 2 and votes[0] == votes[1] == winner:
                    accepted.append(winner)
            if not accepted:
                rejected_trials += 1
                details.append("R")
            else:
                winner = Counter(accepted).most_common(1)[0][0]
                output_counts[winner] += 1
                correct_trials += int(winner == row["label"])
                details.append(str(winner))
        print(f"  {window_seconds:.1f}s: correct={correct_trials}/{len(trial_rows)}, rejected={rejected_trials}, outputs={dict(sorted(output_counts.items()))}, trials={details}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--session", type=Path, help="session directory; defaults to latest recorded session")
    parser.add_argument("--onset", type=float, default=0.5, help="seconds discarded after stimulus onset (default: 0.5)")
    parser.add_argument("--end", type=float, default=4.0, help="window end in seconds after onset (default: 4.0)")
    args = parser.parse_args()
    if not 0 <= args.onset < args.end:
        raise ValueError("analysis window must satisfy 0 <= onset < end")
    return analyze(resolve_session(args.session), args.onset, args.end)


if __name__ == "__main__":
    raise SystemExit(main())

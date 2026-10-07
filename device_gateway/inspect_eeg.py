"""Inspect a recorded BrainGame session in the time and frequency domains.

The preprocessing intentionally mirrors the renderer after the rereference
change: select O1/O2/P3/P4 and subtract each channel's own mean.  No channel
is subtracted from another channel.  The script then computes an averaged,
Hann-windowed FFT so the current session's stimulus bands can be inspected.

Examples (run from the project directory)::

    python -m device_gateway.inspect_eeg
    python -m device_gateway.inspect_eeg --session C:\\...\\Sessions\\<id> --plot
    python -m device_gateway.inspect_eeg --session C:\\...\\captures\\<id> --plot
"""

from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path
from typing import Iterable, Sequence

import numpy as np

from .frame_parser import LegacyFrameParser
from .session_writer import read_eeg_records


ANALYSIS_LEADS = ("O1", "O2", "P3", "P4")
EEG_ATTRIBUTE_ID = 5
TARGET_FREQUENCIES_HZ = (12.0, 16.5)


def target_frequencies_for_session(session_dir: Path) -> tuple[float, ...]:
    """Read target frequencies from markers, with a current-version fallback."""
    marker_path = session_dir / "markers.jsonl"
    if marker_path.is_file():
        for line in marker_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                marker = json.loads(line)
                targets = marker.get("targets") or []
                frequencies = tuple(float(target["frequencyHz"]) for target in targets)
                if frequencies:
                    return frequencies
            except (json.JSONDecodeError, KeyError, TypeError, ValueError):
                continue
    return TARGET_FREQUENCIES_HZ


def default_sessions_root() -> Path:
    return Path.home() / "Documents" / "BrainGame" / "Sessions"


def find_latest_session(root: Path) -> Path:
    candidates = [path for path in root.iterdir() if path.is_dir() and (path / "session.json").is_file()]
    if not candidates:
        raise FileNotFoundError(f"no session directories found under {root}")
    return max(candidates, key=lambda path: (path / "session.json").stat().st_mtime)


def resolve_session(path: Path | None) -> Path:
    if path is None:
        return find_latest_session(default_sessions_root())
    if path.is_file() and path.name in {"eeg.bin", "device-frames.bin"}:
        return path.parent
    if not path.is_dir():
        raise FileNotFoundError(f"session path does not exist: {path}")
    return path


def decode_raw_frame(raw_frame: bytes, channel_count: int) -> np.ndarray | None:
    """Decode one validated legacy AA/.../55 frame into time-major float32."""
    if len(raw_frame) < 9 or raw_frame[0] != 0xAA:
        return None
    attribute_id = raw_frame[1]
    value_count = struct.unpack_from("<H", raw_frame, 2)[0]
    payload_length = struct.unpack_from("<I", raw_frame, 4)[0]
    total_length = 9 + payload_length
    if attribute_id != EEG_ATTRIBUTE_ID or total_length != len(raw_frame) or raw_frame[-1] != 0x55:
        return None
    if payload_length != value_count * 4 or value_count % channel_count:
        return None
    values = np.frombuffer(raw_frame, dtype="<f4", count=value_count, offset=8)
    if not np.isfinite(values).all():
        return None
    return values.reshape((-1, channel_count))


def _dimensions(metadata: dict) -> tuple[float, int, list[str], list[int]]:
    properties = metadata.get("deviceProperties") or metadata.get("properties") or {}
    sample_rate = float(properties.get("sample_rate_hz", 0))
    channel_count = int(properties.get("channel_count", 0))
    lead_names = [str(name).strip().upper() for name in properties.get("lead_names", [])]
    if sample_rate <= 0 or channel_count <= 0 or len(lead_names) != channel_count:
        raise ValueError("recording metadata does not contain valid device dimensions/lead names")
    missing = [lead for lead in ANALYSIS_LEADS if lead not in lead_names]
    if missing:
        raise ValueError(f"required analysis leads missing from recording: {', '.join(missing)}")
    return sample_rate, channel_count, lead_names, [lead_names.index(lead) for lead in ANALYSIS_LEADS]


def _select_blocks(blocks: Iterable[tuple[int, np.ndarray]], seconds: float, sample_rate: float, start_sample: int, indices: list[int]) -> np.ndarray:
    if start_sample < 0:
        raise ValueError("start sample must be non-negative")
    max_samples = None if seconds <= 0 else max(1, int(round(seconds * sample_rate)))
    selected_blocks: list[np.ndarray] = []
    samples_loaded = 0
    for block_start, block in blocks:
        block_end = block_start + len(block)
        if block_end <= start_sample:
            continue
        offset = max(0, start_sample - block_start)
        selected = block[offset:, indices]
        if max_samples is not None and samples_loaded + len(selected) > max_samples:
            selected = selected[: max_samples - samples_loaded]
        if len(selected):
            selected_blocks.append(selected)
            samples_loaded += len(selected)
        if max_samples is not None and samples_loaded >= max_samples:
            break
    if not selected_blocks:
        raise ValueError("no valid EEG attribute-5 records were found")
    return np.concatenate(selected_blocks, axis=0).astype(np.float64, copy=False)


def load_capture(capture_dir: Path, seconds: float, start_sample: int = 0) -> tuple[np.ndarray, float, Sequence[str]]:
    metadata = json.loads((capture_dir / "capture.json").read_text(encoding="utf-8"))
    sample_rate, channel_count, lead_names, indices = _dimensions(metadata)
    parser = LegacyFrameParser(4 * 1024 * 1024)
    frames = parser.feed((capture_dir / "device-frames.bin").read_bytes())
    blocks: list[tuple[int, np.ndarray]] = []
    sample_index = 0
    for frame in frames:
        block = decode_raw_frame(frame.raw_bytes, channel_count)
        if block is not None:
            blocks.append((sample_index, block))
            sample_index += len(block)
    return _select_blocks(blocks, seconds, sample_rate, start_sample, indices), sample_rate, lead_names


def load_session(session_dir: Path, seconds: float, start_sample: int = 0) -> tuple[np.ndarray, float, Sequence[str]]:
    if (session_dir / "capture.json").is_file() and (session_dir / "device-frames.bin").is_file():
        return load_capture(session_dir, seconds, start_sample)
    metadata = json.loads((session_dir / "session.json").read_text(encoding="utf-8"))
    sample_rate, channel_count, lead_names, indices = _dimensions(metadata)
    blocks = ((int(record.first_sample_index), block) for record in read_eeg_records(session_dir / "eeg.bin")
              if (block := decode_raw_frame(record.raw_frame, channel_count)) is not None)
    return _select_blocks(blocks, seconds, sample_rate, start_sample, indices), sample_rate, lead_names


def preprocess(data: np.ndarray) -> np.ndarray:
    """Match renderer preprocessing: remove only each lead's mean."""
    return data - np.mean(data, axis=0, keepdims=True)


def averaged_psd(data: np.ndarray, sample_rate: float, window_seconds: float) -> tuple[np.ndarray, np.ndarray]:
    window_samples = min(len(data), max(16, int(round(window_seconds * sample_rate))))
    if window_samples < 4:
        raise ValueError("not enough samples for a frequency estimate")
    window = np.hanning(window_samples)
    scale = sample_rate * max(np.sum(window * window), 1e-12)
    spectra: list[np.ndarray] = []
    for start in range(0, len(data) - window_samples + 1, window_samples):
        segment = data[start : start + window_samples]
        # The renderer removes the baseline for each analysis window, not
        # once for an entire recording.
        segment = segment - np.mean(segment, axis=0, keepdims=True)
        segment = segment * window[:, None]
        spectra.append(np.abs(np.fft.rfft(segment, axis=0)) ** 2 / scale)
    if not spectra:
        segment = data[:window_samples]
        segment = (segment - np.mean(segment, axis=0, keepdims=True)) * window[:, None]
        spectra.append(np.abs(np.fft.rfft(segment, axis=0)) ** 2 / scale)
    frequencies = np.fft.rfftfreq(window_samples, d=1.0 / sample_rate)
    return frequencies, np.mean(spectra, axis=0)


def top_peaks(frequencies: np.ndarray, spectrum: np.ndarray, low_hz: float = 1, high_hz: float = 45, count: int = 5) -> list[tuple[float, float]]:
    mask = (frequencies >= low_hz) & (frequencies <= high_hz)
    indices = np.flatnonzero(mask)
    if not len(indices):
        return []
    ranked = indices[np.argsort(spectrum[indices])[-count:][::-1]]
    return [(float(frequencies[index]), float(spectrum[index])) for index in ranked]


def band_power(frequencies: np.ndarray, spectrum: np.ndarray, center_hz: float, half_width_hz: float = 0.5) -> float:
    mask = np.abs(frequencies - center_hz) <= half_width_hz
    return float(np.trapz(spectrum[mask], frequencies[mask])) if np.count_nonzero(mask) > 1 else 0.0


def print_report(session_dir: Path, raw: np.ndarray, processed: np.ndarray, sample_rate: float, frequencies: np.ndarray, spectrum: np.ndarray, target_frequencies: tuple[float, ...] = TARGET_FREQUENCIES_HZ) -> None:
    print(f"session: {session_dir}")
    print(f"samples: {len(raw)} per channel ({len(raw) / sample_rate:.2f} s), sample rate: {sample_rate:g} Hz")
    print("preprocess: O1/O2/P3/P4 selected; per-channel mean removed; rereference: OFF")
    print("\ntime-domain statistics (after preprocessing):")
    for index, lead in enumerate(ANALYSIS_LEADS):
        values = processed[:, index]
        print(f"  {lead:>2}: mean={np.mean(values): .5g}, std={np.std(values): .5g}, rms={np.sqrt(np.mean(values * values)): .5g}, range=[{np.min(values): .5g}, {np.max(values): .5g}]")
    correlation = np.corrcoef(processed.T)
    off_diagonal = correlation[np.triu_indices(len(ANALYSIS_LEADS), 1)]
    print(f"  inter-channel correlation: median={np.median(off_diagonal): .4f}, max_abs={np.max(np.abs(off_diagonal)): .4f}")
    if np.max(np.std(processed, axis=0)) < 1e-9:
        print("  WARNING: all selected channels are effectively flat; inspect acquisition software/device connection")
    elif np.max(np.abs(off_diagonal)) > 0.999:
        print("  WARNING: selected channels are nearly identical; possible duplicated/common test data")

    print("\nfrequency-domain peaks (1-45 Hz, averaged Hann FFT):")
    for index, lead in enumerate(ANALYSIS_LEADS):
        peaks = ", ".join(f"{frequency:.2f} Hz" for frequency, _ in top_peaks(frequencies, spectrum[:, index]))
        powers = ", ".join(f"{target:.1f} Hz={band_power(frequencies, spectrum[:, index], target):.4g}" for target in target_frequencies)
        print(f"  {lead:>2}: peaks [{peaks}]; target-band power [{powers}]")


def save_plot(output: Path, raw: np.ndarray, processed: np.ndarray, sample_rate: float, frequencies: np.ndarray, spectrum: np.ndarray, target_frequencies: tuple[float, ...] = TARGET_FREQUENCIES_HZ) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    time = np.arange(len(processed)) / sample_rate
    figure, axes = plt.subplots(2, 4, figsize=(16, 7), constrained_layout=True)
    for index, lead in enumerate(ANALYSIS_LEADS):
        axes[0, index].plot(time, processed[:, index], linewidth=0.6)
        axes[0, index].set_title(f"{lead} · time")
        axes[0, index].set_xlabel("seconds")
        axes[0, index].set_ylabel("amplitude")
        axes[0, index].grid(alpha=0.2)
        frequency_mask = (frequencies >= 1) & (frequencies <= 45)
        axes[1, index].plot(frequencies[frequency_mask], spectrum[frequency_mask, index], linewidth=0.8)
        axes[1, index].set_xlim(1, 45)
        axes[1, index].set_title(f"{lead} · PSD")
        axes[1, index].set_xlabel("Hz")
        axes[1, index].set_ylabel("power")
        axes[1, index].grid(alpha=0.2)
        for target in target_frequencies:
            axes[1, index].axvline(target, color="crimson", alpha=0.55, linestyle="--")
    figure.suptitle("BrainGame EEG inspection (detrended, no rereference)")
    output.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(output, dpi=150)
    plt.close(figure)
    print(f"plot: {output}")


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--session", type=Path, help="session directory or eeg.bin; defaults to latest Documents/BrainGame/Sessions session")
    parser.add_argument("--seconds", type=float, default=20, help="seconds to inspect from --start-sample; 0 means the rest of the session (default: 20)")
    parser.add_argument("--start-sample", type=int, default=0, help="first device sample index to inspect (default: 0)")
    parser.add_argument("--window", type=float, default=4, help="FFT window in seconds (default: 4)")
    parser.add_argument("--plot", action="store_true", help="save a time/frequency plot next to the session")
    parser.add_argument("--output", type=Path, help="PNG path used with --plot")
    args = parser.parse_args(list(argv) if argv is not None else None)

    session_dir = resolve_session(args.session)
    raw, sample_rate, _ = load_session(session_dir, args.seconds, args.start_sample)
    processed = preprocess(raw)
    frequencies, spectrum = averaged_psd(processed, sample_rate, args.window)
    target_frequencies = target_frequencies_for_session(session_dir)
    print_report(session_dir, raw, processed, sample_rate, frequencies, spectrum, target_frequencies)
    if args.plot:
        # Keep the default output in the current project directory; Documents
        # may be read-only when the script is run from a restricted shell.
        output = args.output or (Path.cwd() / f"{session_dir.name}-signal-inspection.png")
        save_plot(output, raw, processed, sample_rate, frequencies, spectrum, target_frequencies)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

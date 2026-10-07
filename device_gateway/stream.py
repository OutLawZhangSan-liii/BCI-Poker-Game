import math
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Deque, List, Optional, Tuple

from .eeg_decoder import EegBlock, decode_eeg_frame
from .frame_parser import LegacyFrameParser
from .protocol import DeviceFrame


@dataclass(frozen=True)
class EegChunk:
    gateway_sequence: int
    first_sample_index: int
    received_monotonic_ns: int
    sample_rate_hz: int
    block: EegBlock
    raw_frame: bytes
    transport_gap_suspected: bool


@dataclass
class StreamStats:
    received_frames: int = 0
    valid_eeg_frames: int = 0
    invalid_eeg_frames: int = 0
    non_eeg_frames: int = 0
    dropped_chunks: int = 0
    suspected_transport_gaps: int = 0
    maximum_queue_depth: int = 0
    dropped_sequence_ranges: List[Tuple[int, int]] = field(default_factory=list)


class EegStreamBuffer:
    """Validates, sequences and bounds EEG chunks before downstream processing."""

    def __init__(
        self,
        channel_count: int,
        sample_rate_hz: int,
        samples_per_packet: int,
        capacity_chunks: int = 64,
        eeg_attribute_id: int = 5,
        gap_tolerance_factor: float = 2.5,
    ) -> None:
        if channel_count <= 0 or sample_rate_hz <= 0 or samples_per_packet <= 0:
            raise ValueError("device dimensions must be positive")
        if capacity_chunks <= 0 or gap_tolerance_factor <= 1:
            raise ValueError("invalid stream buffer settings")
        self.channel_count = channel_count
        self.sample_rate_hz = sample_rate_hz
        self.samples_per_packet = samples_per_packet
        self.capacity_chunks = capacity_chunks
        self.eeg_attribute_id = eeg_attribute_id
        self.gap_tolerance_factor = gap_tolerance_factor
        self.stats = StreamStats()
        self._queue: Deque[EegChunk] = deque()
        self._next_sequence = 0
        self._next_sample_index = 0
        self._last_arrival_ns: Optional[int] = None

    def _record_drop(self, sequence: int) -> None:
        self.stats.dropped_chunks += 1
        ranges = self.stats.dropped_sequence_ranges
        if ranges and ranges[-1][1] + 1 == sequence:
            ranges[-1] = (ranges[-1][0], sequence)
        else:
            ranges.append((sequence, sequence))

    def estimate_sample_index(self, monotonic_ns: int) -> int:
        """Estimate the sample active at a local marker from the latest packet arrival."""
        if self._last_arrival_ns is None:
            return self._next_sample_index
        elapsed_ns = max(0, monotonic_ns - self._last_arrival_ns)
        elapsed_samples = min(
            self.samples_per_packet,
            int(round(elapsed_ns * self.sample_rate_hz / 1_000_000_000)),
        )
        return self._next_sample_index + elapsed_samples

    def ingest(self, frame: DeviceFrame, received_monotonic_ns: int) -> Optional[EegChunk]:
        self.stats.received_frames += 1
        if frame.attribute_id != self.eeg_attribute_id:
            self.stats.non_eeg_frames += 1
            return None
        try:
            block = decode_eeg_frame(frame, self.channel_count)
            if block.samples_per_channel != self.samples_per_packet:
                raise ValueError("unexpected samples per packet")
            if any(not math.isfinite(value) for channel in block.channels for value in channel):
                raise ValueError("non-finite EEG value")
        except ValueError:
            self.stats.invalid_eeg_frames += 1
            return None

        expected_interval_ns = int(
            self.samples_per_packet * 1_000_000_000 / self.sample_rate_hz
        )
        gap = (
            self._last_arrival_ns is not None
            and received_monotonic_ns - self._last_arrival_ns
            > expected_interval_ns * self.gap_tolerance_factor
        )
        if gap:
            self.stats.suspected_transport_gaps += 1

        chunk = EegChunk(
            gateway_sequence=self._next_sequence,
            first_sample_index=self._next_sample_index,
            received_monotonic_ns=received_monotonic_ns,
            sample_rate_hz=self.sample_rate_hz,
            block=block,
            raw_frame=frame.raw_bytes,
            transport_gap_suspected=gap,
        )
        self._next_sequence += 1
        self._next_sample_index += block.samples_per_channel
        self._last_arrival_ns = received_monotonic_ns
        self.stats.valid_eeg_frames += 1

        if len(self._queue) >= self.capacity_chunks:
            dropped = self._queue.popleft()
            self._record_drop(dropped.gateway_sequence)
        self._queue.append(chunk)
        self.stats.maximum_queue_depth = max(
            self.stats.maximum_queue_depth, len(self._queue)
        )
        return chunk

    def pop(self) -> Optional[EegChunk]:
        return self._queue.popleft() if self._queue else None

    def drain(self) -> List[EegChunk]:
        chunks = list(self._queue)
        self._queue.clear()
        return chunks

    def __len__(self) -> int:
        return len(self._queue)


def replay_legacy_frames(
    path: Path,
    stream: EegStreamBuffer,
    read_size: int = 4096,
) -> StreamStats:
    """Replay an exact raw capture through the production streaming parser."""
    if read_size <= 0:
        raise ValueError("read_size must be positive")
    parser = LegacyFrameParser(max_payload_bytes=4 * 1024 * 1024)
    arrival_ns = 0
    expected_interval_ns = int(
        stream.samples_per_packet * 1_000_000_000 / stream.sample_rate_hz
    )
    with path.open("rb") as capture_file:
        while True:
            data = capture_file.read(read_size)
            if not data:
                break
            for frame in parser.feed(data):
                stream.ingest(frame, arrival_ns)
                arrival_ns += expected_interval_ns
    return stream.stats

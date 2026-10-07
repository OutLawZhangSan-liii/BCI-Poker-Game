import math
import struct
import tempfile
import unittest
from pathlib import Path

from device_gateway.frame_parser import LegacyFrameParser
from device_gateway.stream import EegStreamBuffer, replay_legacy_frames


def response(attribute_id: int, value_count: int, payload: bytes) -> bytes:
    return b"\xAA" + bytes((attribute_id,)) + struct.pack("<HI", value_count, len(payload)) + payload + b"\x55"


def eeg_frame(values):
    raw = response(5, len(values), struct.pack("<{}f".format(len(values)), *values))
    return LegacyFrameParser(1024).feed(raw)[0]


class StreamTests(unittest.TestCase):
    def test_sequences_samples_and_bounds_queue(self) -> None:
        stream = EegStreamBuffer(2, 1000, 2, capacity_chunks=2)
        for index in range(4):
            stream.ingest(eeg_frame([index, 10, index + 1, 20]), index * 2_000_000)
        chunks = stream.drain()
        self.assertEqual([chunk.gateway_sequence for chunk in chunks], [2, 3])
        self.assertEqual([chunk.first_sample_index for chunk in chunks], [4, 6])
        self.assertEqual(stream.stats.dropped_chunks, 2)
        self.assertEqual(stream.stats.dropped_sequence_ranges, [(0, 1)])
        self.assertEqual(stream.stats.maximum_queue_depth, 2)

    def test_reports_gap_invalid_and_non_eeg_frames(self) -> None:
        stream = EegStreamBuffer(2, 1000, 2)
        stream.ingest(eeg_frame([1, 2, 3, 4]), 0)
        late = stream.ingest(eeg_frame([1, 2, 3, 4]), 10_000_000)
        invalid = eeg_frame([1, 2, math.nan, 4])
        stream.ingest(invalid, 12_000_000)
        property_frame = LegacyFrameParser(1024).feed(response(1, 1, struct.pack("<I", 1000)))[0]
        stream.ingest(property_frame, 13_000_000)
        self.assertTrue(late.transport_gap_suspected)
        self.assertEqual(stream.stats.suspected_transport_gaps, 1)
        self.assertEqual(stream.stats.invalid_eeg_frames, 1)
        self.assertEqual(stream.stats.non_eeg_frames, 1)

    def test_replay_uses_production_stream_parser(self) -> None:
        raw = b"".join(
            eeg_frame([index, 10, index + 1, 20]).raw_bytes for index in range(3)
        )
        with tempfile.TemporaryDirectory(dir=".") as temporary_directory:
            path = Path(temporary_directory) / "capture.bin"
            path.write_bytes(raw)
            stream = EegStreamBuffer(2, 1000, 2, capacity_chunks=4)
            stats = replay_legacy_frames(path, stream, read_size=7)
        self.assertEqual(stats.valid_eeg_frames, 3)
        self.assertEqual(stats.invalid_eeg_frames, 0)
        self.assertEqual([chunk.gateway_sequence for chunk in stream.drain()], [0, 1, 2])


if __name__ == "__main__":
    unittest.main()

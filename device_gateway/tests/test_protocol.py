import struct
import unittest

from device_gateway.eeg_decoder import decode_eeg_frame
from device_gateway.frame_parser import LegacyFrameParser
from device_gateway.legacy_adapter import LegacyBciAdapter


def response(attribute_id: int, values: int, payload: bytes) -> bytes:
    return b"\xAA" + bytes((attribute_id,)) + struct.pack("<HI", values, len(payload)) + payload + b"\x55"


class ProtocolTests(unittest.TestCase):
    def test_documented_command_golden_vectors(self) -> None:
        adapter = LegacyBciAdapter()
        self.assertEqual(adapter.query_property_command(0), bytes.fromhex("A5 01 00 5A"))
        self.assertEqual(adapter.query_property_command(4), bytes.fromhex("A5 01 04 5A"))
        self.assertEqual(adapter.start_acquisition_command(), bytes.fromhex("A5 10 01 5A"))
        self.assertEqual(adapter.stop_acquisition_command(), bytes.fromhex("A5 10 02 5A"))

    def test_partial_sticky_noise_and_payload_header(self) -> None:
        parser = LegacyFrameParser(1024)
        first = response(1, 1, b"\x00\xAA\x02\x00")
        second = response(2, 1, struct.pack("<I", 16))
        self.assertEqual(parser.feed(b"noise" + first[:7]), [])
        frames = parser.feed(first[7:] + second)
        self.assertEqual([frame.attribute_id for frame in frames], [1, 2])
        self.assertEqual(frames[0].payload, b"\x00\xAA\x02\x00")
        self.assertEqual(parser.discarded_bytes, 5)

    def test_recovers_after_invalid_tail(self) -> None:
        parser = LegacyFrameParser(1024)
        invalid = response(1, 1, struct.pack("<I", 250))[:-1] + b"\x00"
        valid = response(2, 1, struct.pack("<I", 32))
        frames = parser.feed(invalid + valid)
        self.assertEqual(len(frames), 1)
        self.assertEqual(frames[0].attribute_id, 2)
        self.assertEqual(parser.invalid_frames, 1)

    def test_rejects_oversized_payload_header(self) -> None:
        parser = LegacyFrameParser(8)
        oversized_header = b"\xAA\x05\x01\x00" + struct.pack("<I", 100)
        frames = parser.feed(oversized_header + response(1, 1, struct.pack("<I", 500)))
        self.assertEqual(len(frames), 1)
        self.assertEqual(frames[0].attribute_id, 1)
        self.assertEqual(parser.invalid_frames, 1)

    def test_decodes_interleaved_little_endian_eeg(self) -> None:
        payload = struct.pack("<6f", 1.0, 10.0, 2.0, 20.0, 3.0, 30.0)
        frame = LegacyFrameParser(1024).feed(response(5, 6, payload))[0]
        block = decode_eeg_frame(frame, channel_count=2)
        self.assertEqual(block.channels, [[1.0, 2.0, 3.0], [10.0, 20.0, 30.0]])
        self.assertEqual(block.sample_unit, "μV")

    def test_lead_names_accept_real_software_whitespace_padding(self) -> None:
        adapter = LegacyBciAdapter()
        payload = b"FP1\t    " + b"CZ\0\0\0\0\0\0"
        frame = LegacyFrameParser(1024).feed(response(4, 2, payload))[0]
        self.assertEqual(adapter.decode_lead_names(frame), ["FP1", "CZ"])


if __name__ == "__main__":
    unittest.main()

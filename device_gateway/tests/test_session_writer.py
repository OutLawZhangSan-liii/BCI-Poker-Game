import json
import struct
import tempfile
import unittest
from pathlib import Path

from device_gateway.frame_parser import LegacyFrameParser
from device_gateway.session_writer import (
    SessionWriter,
    read_eeg_records,
    recover_incomplete_sessions,
)
from device_gateway.stream import EegStreamBuffer


def make_chunk():
    payload = struct.pack("<4f", 1.0, 10.0, 2.0, 20.0)
    raw = b"\xAA\x05" + struct.pack("<HI", 4, len(payload)) + payload + b"\x55"
    frame = LegacyFrameParser(1024).feed(raw)[0]
    stream = EegStreamBuffer(2, 1000, 2)
    return stream.ingest(frame, 123456789)


class SessionWriterTests(unittest.TestCase):
    def test_completed_session_is_readable_and_counted(self) -> None:
        with tempfile.TemporaryDirectory(dir=".") as temporary_directory:
            root = Path(temporary_directory)
            writer = SessionWriter(root, "session-1", {"sampleRateHz": 1000})
            chunk = make_chunk()
            writer.write_eeg_chunk(chunk)
            writer.write_marker({"trialId": "trial-1", "frame": 10})
            writer.write_decision({"trialId": "trial-1", "candidateIndex": 2})
            writer.complete()

            session = json.loads((writer.directory / "session.json").read_text("utf-8"))
            self.assertEqual(session["status"], "completed")
            self.assertEqual(session["sampleUnit"], "μV")
            self.assertEqual(session["eegRecordCount"], 1)
            self.assertEqual(session["eegSampleCountPerChannel"], 2)
            records = list(read_eeg_records(writer.directory / "eeg.bin"))
            self.assertEqual(records[0].gateway_sequence, 0)
            self.assertEqual(records[0].raw_frame, chunk.raw_frame)
            self.assertEqual(len((writer.directory / "markers.jsonl").read_text("utf-8").splitlines()), 1)
            self.assertEqual(len((writer.directory / "decisions.jsonl").read_text("utf-8").splitlines()), 1)

    def test_context_exception_marks_session_incomplete(self) -> None:
        with tempfile.TemporaryDirectory(dir=".") as temporary_directory:
            root = Path(temporary_directory)
            with self.assertRaisesRegex(RuntimeError, "boom"):
                with SessionWriter(root, "session-2", {}) as writer:
                    raise RuntimeError("boom")
            metadata = json.loads((writer.directory / "session.json").read_text("utf-8"))
            self.assertEqual(metadata["status"], "incomplete")
            self.assertEqual(metadata["completionReason"], "exception")

    def test_recovery_marks_only_in_progress_sessions(self) -> None:
        with tempfile.TemporaryDirectory(dir=".") as temporary_directory:
            root = Path(temporary_directory)
            writer = SessionWriter(root, "crashed-session", {})
            writer.flush()
            # Simulate process loss by closing handles without finalizing metadata.
            for file_object in (writer._eeg, writer._events, writer._markers, writer._decisions):
                file_object.close()
            writer._closed = True

            recovered = recover_incomplete_sessions(root)
            self.assertEqual(recovered, ["crashed-session"])
            metadata = json.loads((writer.directory / "session.json").read_text("utf-8"))
            self.assertEqual(metadata["status"], "incomplete")
            self.assertEqual(metadata["completionReason"], "recovered_after_unclean_exit")
            self.assertEqual(recover_incomplete_sessions(root), [])

    def test_reader_rejects_truncated_record(self) -> None:
        with tempfile.TemporaryDirectory(dir=".") as temporary_directory:
            path = Path(temporary_directory) / "eeg.bin"
            path.write_bytes(b"BGEG\x01\x00" + b"\x00")
            with self.assertRaisesRegex(ValueError, "truncated EEG record header"):
                list(read_eeg_records(path))


if __name__ == "__main__":
    unittest.main()

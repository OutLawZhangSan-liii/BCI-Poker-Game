import json
import os
import struct
import threading
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from .stream import EegChunk
from .eeg_decoder import EEG_SAMPLE_UNIT


EEG_FILE_MAGIC = b"BGEG"
EEG_FILE_VERSION = 1
EEG_FILE_HEADER = struct.Struct("<4sH")
EEG_RECORD_HEADER = struct.Struct("<QQQI")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def atomic_write_json(path: Path, value: Dict[str, Any]) -> None:
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as output:
        json.dump(value, output, ensure_ascii=False, indent=2)
        output.write("\n")
        output.flush()
        os.fsync(output.fileno())
    os.replace(str(temporary), str(path))


@dataclass(frozen=True)
class EegRecord:
    gateway_sequence: int
    first_sample_index: int
    received_monotonic_ns: int
    raw_frame: bytes


class SessionWriter:
    """Crash-visible, offline-first writer for one immutable session directory."""

    def __init__(
        self,
        sessions_root: Path,
        session_id: str,
        device_properties: Dict[str, Any],
        application_version: str = "development",
        protocol_version: int = 1,
    ) -> None:
        if not session_id or any(char in session_id for char in '<>:"/\\|?*'):
            raise ValueError("session_id is empty or contains an invalid path character")
        self.session_id = session_id
        self.directory = sessions_root / session_id
        self.directory.mkdir(parents=True, exist_ok=False)
        self._lock = threading.Lock()
        self._closed = False
        self._eeg_records = 0
        self._eeg_samples = 0
        self._metadata: Dict[str, Any] = {
            "schemaVersion": 1,
            "sessionId": session_id,
            "status": "in_progress",
            "startedAt": utc_now(),
            "finishedAt": None,
            "applicationVersion": application_version,
            "protocolVersion": protocol_version,
            "deviceProperties": device_properties,
            "sampleUnit": EEG_SAMPLE_UNIT,
            "eegRecordCount": 0,
            "eegSampleCountPerChannel": 0,
            "completionReason": None,
            "error": None,
        }
        atomic_write_json(self.directory / "session.json", self._metadata)
        self._eeg = (self.directory / "eeg.bin").open("xb")
        self._eeg.write(EEG_FILE_HEADER.pack(EEG_FILE_MAGIC, EEG_FILE_VERSION))
        self._events = (self.directory / "events.jsonl").open(
            "x", encoding="utf-8", newline="\n"
        )
        self._markers = (self.directory / "markers.jsonl").open(
            "x", encoding="utf-8", newline="\n"
        )
        self._decisions = (self.directory / "decisions.jsonl").open(
            "x", encoding="utf-8", newline="\n"
        )
        self.write_event("session_started", {"sessionId": session_id})

    def _ensure_open(self) -> None:
        if self._closed:
            raise RuntimeError("session writer is closed")

    @staticmethod
    def _write_jsonl(file_object, record: Dict[str, Any]) -> None:
        file_object.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")))
        file_object.write("\n")
        file_object.flush()

    def write_event(self, event_type: str, data: Optional[Dict[str, Any]] = None) -> None:
        with self._lock:
            self._ensure_open()
            self._write_jsonl(
                self._events,
                {"timestamp": utc_now(), "type": event_type, "data": data or {}},
            )

    def write_marker(self, marker: Dict[str, Any]) -> None:
        with self._lock:
            self._ensure_open()
            self._write_jsonl(self._markers, marker)

    def write_decision(self, decision: Dict[str, Any]) -> None:
        with self._lock:
            self._ensure_open()
            self._write_jsonl(self._decisions, decision)

    def write_model(self, model: Dict[str, Any]) -> None:
        with self._lock:
            self._ensure_open()
            atomic_write_json(self.directory / "calibration-model.json", model)
            self._write_jsonl(
                self._events,
                {"timestamp": utc_now(), "type": "calibration_model_saved", "data": {
                    "algorithm": model.get("algorithm"), "algorithmVersion": model.get("algorithmVersion")}},
            )

    def write_eeg_chunk(self, chunk: EegChunk) -> None:
        with self._lock:
            self._ensure_open()
            self._eeg.write(
                EEG_RECORD_HEADER.pack(
                    chunk.gateway_sequence,
                    chunk.first_sample_index,
                    chunk.received_monotonic_ns,
                    len(chunk.raw_frame),
                )
            )
            self._eeg.write(chunk.raw_frame)
            self._eeg_records += 1
            self._eeg_samples += chunk.block.samples_per_channel

    def flush(self) -> None:
        with self._lock:
            self._ensure_open()
            for file_object in (self._eeg, self._events, self._markers, self._decisions):
                file_object.flush()
                os.fsync(file_object.fileno())

    def _finish(self, status: str, reason: str, error: Optional[str]) -> None:
        with self._lock:
            if self._closed:
                return
            self._write_jsonl(
                self._events,
                {
                    "timestamp": utc_now(),
                    "type": "session_{}".format(status),
                    "data": {"reason": reason, "error": error},
                },
            )
            for file_object in (self._eeg, self._events, self._markers, self._decisions):
                file_object.flush()
                os.fsync(file_object.fileno())
                file_object.close()
            self._metadata.update(
                {
                    "status": status,
                    "finishedAt": utc_now(),
                    "eegRecordCount": self._eeg_records,
                    "eegSampleCountPerChannel": self._eeg_samples,
                    "completionReason": reason,
                    "error": error,
                }
            )
            atomic_write_json(self.directory / "session.json", self._metadata)
            self._closed = True

    def complete(self, reason: str = "completed") -> None:
        self._finish("completed", reason, None)

    def abort(self, reason: str, error: Optional[str] = None) -> None:
        self._finish("incomplete", reason, error)

    def __enter__(self) -> "SessionWriter":
        return self

    def __exit__(self, exception_type, exception, traceback) -> None:
        if exception is None:
            self.complete()
        else:
            self.abort("exception", "{}: {}".format(exception_type.__name__, exception))


def read_eeg_records(path: Path) -> Iterable[EegRecord]:
    with path.open("rb") as input_file:
        header = input_file.read(EEG_FILE_HEADER.size)
        if len(header) != EEG_FILE_HEADER.size:
            raise ValueError("truncated EEG file header")
        magic, version = EEG_FILE_HEADER.unpack(header)
        if magic != EEG_FILE_MAGIC or version != EEG_FILE_VERSION:
            raise ValueError("unsupported EEG file format")
        while True:
            record_header = input_file.read(EEG_RECORD_HEADER.size)
            if not record_header:
                break
            if len(record_header) != EEG_RECORD_HEADER.size:
                raise ValueError("truncated EEG record header")
            sequence, first_sample, monotonic_ns, raw_length = EEG_RECORD_HEADER.unpack(
                record_header
            )
            raw_frame = input_file.read(raw_length)
            if len(raw_frame) != raw_length:
                raise ValueError("truncated EEG record payload")
            yield EegRecord(sequence, first_sample, monotonic_ns, raw_frame)


def recover_incomplete_sessions(sessions_root: Path) -> List[str]:
    """Mark sessions left in-progress by a prior crash; never deletes data."""
    recovered: List[str] = []
    if not sessions_root.exists():
        return recovered
    for metadata_path in sessions_root.glob("*/session.json"):
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if metadata.get("status") != "in_progress":
            continue
        metadata.update(
            {
                "status": "incomplete",
                "finishedAt": utc_now(),
                "completionReason": "recovered_after_unclean_exit",
                "error": "application exited before session finalization",
            }
        )
        atomic_write_json(metadata_path, metadata)
        events_path = metadata_path.parent / "events.jsonl"
        with events_path.open("a", encoding="utf-8", newline="\n") as events:
            events.write(
                json.dumps(
                    {
                        "timestamp": utc_now(),
                        "type": "session_incomplete",
                        "data": {"reason": "recovered_after_unclean_exit"},
                    },
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
                + "\n"
            )
            events.flush()
            os.fsync(events.fileno())
        recovered.append(str(metadata.get("sessionId", metadata_path.parent.name)))
    return recovered

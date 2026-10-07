import json
import struct
import uuid
from dataclasses import dataclass
from typing import Any, Dict

from .stream import EegChunk


PROTOCOL_VERSION = 1
EEG_CHUNK_MESSAGE_TYPE = 1
EEG_CHUNK_HEADER = struct.Struct("<4sHH16sQQQIHHI")


def command_result(
    request_id: str,
    command: str,
    ok: bool,
    confirmation: str = "sent",
    error: Any = None,
    data: Any = None,
) -> Dict[str, Any]:
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "requestId": request_id,
        "type": "command_result",
        "command": command,
        "ok": ok,
        "confirmation": confirmation,
        "error": error,
        "data": data,
    }


def encode_eeg_chunk(session_id: str, chunk: EegChunk) -> bytes:
    session_bytes = uuid.UUID(session_id).bytes
    flags = 1 if chunk.transport_gap_suspected else 0
    header = EEG_CHUNK_HEADER.pack(
        b"BGEE",
        PROTOCOL_VERSION,
        EEG_CHUNK_MESSAGE_TYPE,
        session_bytes,
        chunk.gateway_sequence,
        chunk.first_sample_index,
        chunk.received_monotonic_ns,
        chunk.sample_rate_hz,
        chunk.block.channel_count,
        chunk.block.samples_per_channel,
        flags,
    )
    # The validated device payload is already time-major, channel-interleaved f32.
    raw = chunk.raw_frame
    payload_length = int.from_bytes(raw[4:8], "little")
    return header + raw[8 : 8 + payload_length]


def parse_json_message(payload: bytes) -> Dict[str, Any]:
    try:
        value = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise ValueError("control message must be UTF-8 JSON") from exc
    if not isinstance(value, dict):
        raise ValueError("control message must be a JSON object")
    return value

import struct
from typing import Sequence

from .frame_parser import LegacyFrameParser
from .protocol import DeviceFrame


class LegacyBciAdapter:
    """Adapter for the currently documented local acquisition software protocol."""

    name = "legacy-bci-tcp-v1"
    EEG_ATTRIBUTE_ID = 5

    def __init__(self, max_payload_bytes: int = 4 * 1024 * 1024) -> None:
        self._parser = LegacyFrameParser(max_payload_bytes)

    @staticmethod
    def _command(command: int, argument: int) -> bytes:
        if not 0 <= argument <= 0xFF:
            raise ValueError("command argument must fit in one byte")
        return bytes((0xA5, command, argument, 0x5A))

    def query_property_command(self, property_id: int) -> bytes:
        return self._command(0x01, property_id)

    def start_acquisition_command(self) -> bytes:
        return self._command(0x10, 0x01)

    def stop_acquisition_command(self) -> bytes:
        return self._command(0x10, 0x02)

    def feed(self, data: bytes) -> Sequence[DeviceFrame]:
        return self._parser.feed(data)

    @staticmethod
    def decode_uint32_property(frame: DeviceFrame) -> int:
        if len(frame.payload) < 4:
            raise ValueError("uint32 property payload is shorter than 4 bytes")
        return struct.unpack_from("<I", frame.payload)[0]

    @staticmethod
    def decode_lead_names(frame: DeviceFrame) -> Sequence[str]:
        if len(frame.payload) % 8:
            raise ValueError("lead-name payload length must be a multiple of 8")
        return [
            frame.payload[i : i + 8]
            .split(b"\0", 1)[0]
            .decode("ascii")
            .strip()
            for i in range(0, len(frame.payload), 8)
        ]

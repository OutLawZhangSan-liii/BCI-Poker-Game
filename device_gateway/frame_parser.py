import struct
from typing import List

from .protocol import DeviceFrame


class LegacyFrameParser:
    """Streaming parser for AA/id/count/length/payload/55 frames.

    It tolerates noise, partial frames, sticky packets and invalid tails. A header
    byte inside payload is never treated as a new frame before the declared frame
    length has arrived.
    """

    HEADER = 0xAA
    TAIL = 0x55
    FIXED_BYTES = 9

    def __init__(self, max_payload_bytes: int) -> None:
        if max_payload_bytes <= 0:
            raise ValueError("max_payload_bytes must be positive")
        self._max_payload_bytes = max_payload_bytes
        self._buffer = bytearray()
        self.invalid_frames = 0
        self.discarded_bytes = 0

    def reset(self) -> None:
        self._buffer.clear()

    def feed(self, data: bytes) -> List[DeviceFrame]:
        self._buffer.extend(data)
        frames: List[DeviceFrame] = []

        while True:
            header_index = self._buffer.find(bytes((self.HEADER,)))
            if header_index < 0:
                self.discarded_bytes += len(self._buffer)
                self._buffer.clear()
                break
            if header_index:
                self.discarded_bytes += header_index
                del self._buffer[:header_index]
            if len(self._buffer) < 8:
                break

            attribute_id = self._buffer[1]
            value_count = struct.unpack_from("<H", self._buffer, 2)[0]
            data_length = struct.unpack_from("<I", self._buffer, 4)[0]
            if data_length > self._max_payload_bytes:
                self.invalid_frames += 1
                self.discarded_bytes += 1
                del self._buffer[0]
                continue

            total_length = self.FIXED_BYTES + data_length
            if len(self._buffer) < total_length:
                break
            if self._buffer[total_length - 1] != self.TAIL:
                self.invalid_frames += 1
                self.discarded_bytes += 1
                del self._buffer[0]
                continue

            raw_bytes = bytes(self._buffer[:total_length])
            payload = bytes(self._buffer[8 : 8 + data_length])
            frames.append(DeviceFrame(attribute_id, value_count, payload, raw_bytes))
            del self._buffer[:total_length]

        return frames

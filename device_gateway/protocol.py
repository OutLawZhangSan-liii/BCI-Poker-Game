from dataclasses import dataclass
from typing import Protocol, Sequence


@dataclass(frozen=True)
class DeviceFrame:
    attribute_id: int
    value_count: int
    payload: bytes
    # Exact validated bytes received from the acquisition software. Keeping this
    # allows protocol regression tests without re-encoding vendor frames.
    raw_bytes: bytes = b""


class ProtocolAdapter(Protocol):
    """The only vendor-specific boundary used by ``DeviceClient``."""

    name: str

    def query_property_command(self, property_id: int) -> bytes: ...

    def start_acquisition_command(self) -> bytes: ...

    def stop_acquisition_command(self) -> bytes: ...

    def feed(self, data: bytes) -> Sequence[DeviceFrame]: ...

    def decode_uint32_property(self, frame: DeviceFrame) -> int: ...

    def decode_lead_names(self, frame: DeviceFrame) -> Sequence[str]: ...

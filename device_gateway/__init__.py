"""Brain Game device gateway core.

Keep device/vendor-specific behavior behind ``ProtocolAdapter`` implementations.
"""

from .config import GatewayConfig
from .device_client import DeviceClient
from .legacy_adapter import LegacyBciAdapter
from .stream import EegStreamBuffer
from .session_writer import SessionWriter

__all__ = [
    "DeviceClient",
    "EegStreamBuffer",
    "GatewayConfig",
    "LegacyBciAdapter",
    "SessionWriter",
]

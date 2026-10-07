import socket
import time
from collections import deque
from dataclasses import dataclass
from enum import Enum
from typing import Deque, Optional

from .config import GatewayConfig
from .protocol import DeviceFrame, ProtocolAdapter
from .transport import TcpTransport, Transport


class DeviceState(str, Enum):
    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    IDLE = "idle"
    QUERYING_PROPERTIES = "querying_properties"
    STARTING = "starting"
    ACQUIRING = "acquiring"
    STOPPING = "stopping"
    FAULTED = "faulted"


@dataclass(frozen=True)
class DeviceProperties:
    acquisition_status: int
    sample_rate_hz: int
    samples_per_packet: int
    channel_count: int
    lead_names: tuple


class DeviceClient:
    """Acquisition workflow independent of TCP framing and vendor protocol details."""

    def __init__(
        self,
        config: GatewayConfig,
        adapter: ProtocolAdapter,
        transport: Optional[Transport] = None,
    ) -> None:
        self.config = config
        self.adapter = adapter
        self.transport = transport or TcpTransport(config)
        self.state = DeviceState.DISCONNECTED
        self._pending_frames: Deque[DeviceFrame] = deque()

    def connect(self) -> None:
        if self.state not in (DeviceState.DISCONNECTED, DeviceState.FAULTED):
            return
        self.state = DeviceState.CONNECTING
        try:
            self.transport.connect()
            self.state = DeviceState.IDLE
        except Exception:
            self.state = DeviceState.FAULTED
            raise

    def close(self) -> None:
        self.transport.close()
        self._pending_frames.clear()
        self.state = DeviceState.DISCONNECTED

    def reconnect(self, attempts: int = 3, backoff_seconds: float = 0.25) -> None:
        if attempts <= 0 or backoff_seconds < 0:
            raise ValueError("invalid reconnect policy")
        last_error = None
        for attempt in range(attempts):
            self.close()
            try:
                self.connect()
                return
            except (ConnectionError, OSError) as exc:
                last_error = exc
                if attempt + 1 < attempts:
                    time.sleep(backoff_seconds * (attempt + 1))
        raise ConnectionError("reconnect failed after {} attempts".format(attempts)) from last_error

    def _receive_attribute(self, attribute_id: int) -> DeviceFrame:
        for cached in tuple(self._pending_frames):
            if cached.attribute_id == attribute_id:
                self._pending_frames.remove(cached)
                return cached
        while True:
            data = self.transport.receive(self.config.receive_chunk_bytes)
            for frame in self.adapter.feed(data):
                if frame.attribute_id == attribute_id:
                    return frame
                self._pending_frames.append(frame)

    def receive_frames(self):
        """Receive and parse the next transport chunk.

        Intended for the gateway's acquisition loop. The iterable may contain
        multiple frames because TCP packets do not preserve message boundaries.
        """
        if self.state != DeviceState.ACQUIRING:
            raise RuntimeError("device must be acquiring before receiving EEG")
        if self._pending_frames:
            frames = list(self._pending_frames)
            self._pending_frames.clear()
            return frames
        try:
            data = self.transport.receive(self.config.receive_chunk_bytes)
            return self.adapter.feed(data)
        except socket.timeout:
            raise
        except (ConnectionError, OSError):
            self.state = DeviceState.FAULTED
            raise

    def query_property(self, property_id: int) -> DeviceFrame:
        if self.state not in (
            DeviceState.IDLE,
            DeviceState.QUERYING_PROPERTIES,
            DeviceState.STARTING,
            DeviceState.ACQUIRING,
            DeviceState.STOPPING,
        ):
            raise RuntimeError("device must be connected before querying properties")
        self.transport.send_all(self.adapter.query_property_command(property_id))
        try:
            return self._receive_attribute(property_id)
        except (socket.timeout, TimeoutError) as exc:
            raise TimeoutError("property {} query timed out".format(property_id)) from exc
        except (ConnectionError, OSError):
            self.state = DeviceState.FAULTED
            raise

    def query_properties(self) -> DeviceProperties:
        if self.state != DeviceState.IDLE:
            raise RuntimeError("device must be idle before querying all properties")
        self.state = DeviceState.QUERYING_PROPERTIES
        try:
            values = {
                property_id: self.query_property(property_id) for property_id in range(5)
            }
            return DeviceProperties(
                acquisition_status=self.adapter.decode_uint32_property(values[0]),
                sample_rate_hz=self.adapter.decode_uint32_property(values[1]),
                samples_per_packet=self.adapter.decode_uint32_property(values[2]),
                channel_count=self.adapter.decode_uint32_property(values[3]),
                lead_names=tuple(self.adapter.decode_lead_names(values[4])),
            )
        finally:
            if self.state == DeviceState.QUERYING_PROPERTIES:
                self.state = DeviceState.IDLE

    def start_acquisition(self) -> None:
        if self.state != DeviceState.IDLE:
            raise RuntimeError("device must be idle before acquisition starts")
        self.state = DeviceState.STARTING
        try:
            self.transport.send_all(self.adapter.start_acquisition_command())
            # Sent, not yet device-confirmed. The first valid EEG frame is the
            # fallback confirmation supported by the current software.
            self.state = DeviceState.ACQUIRING
        except Exception:
            self.state = DeviceState.FAULTED
            raise

    def stop_acquisition(
        self,
        confirm: bool = False,
        grace_seconds: float = 0.5,
    ) -> str:
        if self.state != DeviceState.ACQUIRING:
            return "already_stopped"
        if grace_seconds < 0:
            raise ValueError("grace_seconds cannot be negative")
        self.state = DeviceState.STOPPING
        try:
            self.transport.send_all(self.adapter.stop_acquisition_command())
            if confirm:
                time.sleep(grace_seconds)
                try:
                    status_frame = self.query_property(0)
                    status = self.adapter.decode_uint32_property(status_frame)
                    if status == 0:
                        self.state = DeviceState.IDLE
                        return "device_status"
                except TimeoutError:
                    # The protocol permits a silence-based fallback. Keep the
                    # weaker result explicit for session metadata.
                    pass
            self.state = DeviceState.IDLE
            return "sent"
        except Exception:
            self.state = DeviceState.FAULTED
            raise

    def __enter__(self) -> "DeviceClient":
        self.connect()
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

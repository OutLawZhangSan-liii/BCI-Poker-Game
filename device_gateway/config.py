from dataclasses import dataclass


@dataclass(frozen=True)
class GatewayConfig:
    """Runtime settings; no device address is hard-coded into the client."""

    host: str = "127.0.0.1"
    port: int = 7110
    connect_timeout_seconds: float = 3.0
    receive_timeout_seconds: float = 3.0
    receive_chunk_bytes: int = 64 * 1024
    # Conservative safety limit until a real maximum frame is captured.
    max_payload_bytes: int = 4 * 1024 * 1024

    def __post_init__(self) -> None:
        if not self.host:
            raise ValueError("host cannot be empty")
        if not 1 <= self.port <= 65535:
            raise ValueError("port must be in 1..65535")
        if self.connect_timeout_seconds <= 0 or self.receive_timeout_seconds <= 0:
            raise ValueError("timeouts must be positive")
        if self.receive_chunk_bytes <= 0 or self.max_payload_bytes <= 0:
            raise ValueError("buffer sizes must be positive")


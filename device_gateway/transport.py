import socket
from abc import ABC, abstractmethod
from typing import Optional

from .config import GatewayConfig


class Transport(ABC):
    """Byte-stream boundary. Alternate software can provide another transport."""

    @abstractmethod
    def connect(self) -> None: ...

    @abstractmethod
    def send_all(self, data: bytes) -> None: ...

    @abstractmethod
    def receive(self, max_bytes: int) -> bytes: ...

    @abstractmethod
    def close(self) -> None: ...


class TcpTransport(Transport):
    def __init__(self, config: GatewayConfig) -> None:
        self._config = config
        self._socket: Optional[socket.socket] = None

    @property
    def connected(self) -> bool:
        return self._socket is not None

    def connect(self) -> None:
        if self._socket is not None:
            return
        sock = socket.create_connection(
            (self._config.host, self._config.port),
            timeout=self._config.connect_timeout_seconds,
        )
        sock.settimeout(self._config.receive_timeout_seconds)
        self._socket = sock

    def send_all(self, data: bytes) -> None:
        if self._socket is None:
            raise ConnectionError("transport is not connected")
        self._socket.sendall(data)

    def receive(self, max_bytes: int) -> bytes:
        if self._socket is None:
            raise ConnectionError("transport is not connected")
        data = self._socket.recv(max_bytes)
        if not data:
            raise ConnectionError("acquisition software closed the connection")
        return data

    def close(self) -> None:
        sock, self._socket = self._socket, None
        if sock is not None:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            sock.close()

    def __enter__(self) -> "TcpTransport":
        self.connect()
        return self

    def __exit__(self, *_: object) -> None:
        self.close()


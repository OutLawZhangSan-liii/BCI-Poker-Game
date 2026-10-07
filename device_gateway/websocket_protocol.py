import base64
import hashlib
import os
import socket
import struct
from dataclasses import dataclass
from typing import Dict, Tuple


WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


class WebSocketProtocolError(Exception):
    pass


@dataclass(frozen=True)
class WebSocketFrame:
    opcode: int
    payload: bytes
    final: bool = True


def read_http_request(connection: socket.socket, limit: int = 16 * 1024) -> bytes:
    data = bytearray()
    while b"\r\n\r\n" not in data:
        chunk = connection.recv(4096)
        if not chunk:
            raise ConnectionError("connection closed during WebSocket handshake")
        data.extend(chunk)
        if len(data) > limit:
            raise WebSocketProtocolError("HTTP upgrade request is too large")
    return bytes(data)


def parse_upgrade_request(request: bytes) -> Tuple[str, Dict[str, str]]:
    try:
        text = request.decode("iso-8859-1")
        lines = text.split("\r\n")
        method, path, version = lines[0].split(" ", 2)
    except (UnicodeDecodeError, ValueError, IndexError) as exc:
        raise WebSocketProtocolError("invalid HTTP request") from exc
    if method != "GET" or version != "HTTP/1.1":
        raise WebSocketProtocolError("invalid WebSocket upgrade request line")
    headers = {}
    for line in lines[1:]:
        if not line:
            break
        if ":" not in line:
            raise WebSocketProtocolError("invalid HTTP header")
        name, value = line.split(":", 1)
        headers[name.strip().lower()] = value.strip()
    if headers.get("upgrade", "").lower() != "websocket":
        raise WebSocketProtocolError("missing WebSocket upgrade header")
    if "upgrade" not in headers.get("connection", "").lower():
        raise WebSocketProtocolError("missing connection upgrade token")
    if headers.get("sec-websocket-version") != "13":
        raise WebSocketProtocolError("unsupported WebSocket version")
    if "sec-websocket-key" not in headers:
        raise WebSocketProtocolError("missing WebSocket key")
    return path, headers


def accept_upgrade(connection: socket.socket, headers: Dict[str, str]) -> None:
    accept = base64.b64encode(
        hashlib.sha1((headers["sec-websocket-key"] + WEBSOCKET_GUID).encode("ascii")).digest()
    ).decode("ascii")
    response = (
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        "Sec-WebSocket-Accept: {}\r\n\r\n".format(accept)
    )
    connection.sendall(response.encode("ascii"))


def _receive_exact(connection: socket.socket, size: int) -> bytes:
    result = bytearray()
    while len(result) < size:
        chunk = connection.recv(size - len(result))
        if not chunk:
            raise ConnectionError("WebSocket peer closed the connection")
        result.extend(chunk)
    return bytes(result)


def receive_frame(
    connection: socket.socket,
    max_payload_bytes: int = 1024 * 1024,
    require_mask: bool = True,
) -> WebSocketFrame:
    first, second = _receive_exact(connection, 2)
    final = bool(first & 0x80)
    opcode = first & 0x0F
    masked = bool(second & 0x80)
    length = second & 0x7F
    if require_mask and not masked:
        raise WebSocketProtocolError("client WebSocket frame must be masked")
    if length == 126:
        length = struct.unpack("!H", _receive_exact(connection, 2))[0]
    elif length == 127:
        length = struct.unpack("!Q", _receive_exact(connection, 8))[0]
    if length > max_payload_bytes:
        raise WebSocketProtocolError("WebSocket message exceeds configured limit")
    mask = _receive_exact(connection, 4) if masked else b""
    payload = bytearray(_receive_exact(connection, length))
    if masked:
        for index in range(length):
            payload[index] ^= mask[index % 4]
    return WebSocketFrame(opcode, bytes(payload), final)


def receive_message(
    connection: socket.socket,
    max_payload_bytes: int = 1024 * 1024,
    require_mask: bool = True,
) -> WebSocketFrame:
    """Receive a complete WebSocket message, joining continuation frames."""
    first = receive_frame(connection, max_payload_bytes, require_mask)
    if first.final:
        return first
    if first.opcode not in (1, 2):
        raise WebSocketProtocolError("only text or binary messages may be fragmented")
    payload = bytearray(first.payload)
    while True:
        remaining = max_payload_bytes - len(payload)
        if remaining < 0:
            raise WebSocketProtocolError("WebSocket message exceeds configured limit")
        continuation = receive_frame(connection, remaining, require_mask)
        if continuation.opcode != 0:
            raise WebSocketProtocolError("fragmented message requires continuation frames")
        payload.extend(continuation.payload)
        if len(payload) > max_payload_bytes:
            raise WebSocketProtocolError("WebSocket message exceeds configured limit")
        if continuation.final:
            return WebSocketFrame(first.opcode, bytes(payload), True)


def encode_frame(opcode: int, payload: bytes, mask: bool = False, final: bool = True) -> bytes:
    first = (0x80 if final else 0) | opcode
    length = len(payload)
    mask_flag = 0x80 if mask else 0
    if length < 126:
        header = bytes((first, mask_flag | length))
    elif length <= 0xFFFF:
        header = bytes((first, mask_flag | 126)) + struct.pack("!H", length)
    else:
        header = bytes((first, mask_flag | 127)) + struct.pack("!Q", length)
    if not mask:
        return header + payload
    key = os.urandom(4)
    masked = bytes(value ^ key[index % 4] for index, value in enumerate(payload))
    return header + key + masked

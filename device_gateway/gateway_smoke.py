import argparse
import base64
import json
import os
import socket
import threading
import time
import uuid

from .config import GatewayConfig
from .messages import EEG_CHUNK_HEADER, PROTOCOL_VERSION
from .websocket_protocol import encode_frame, receive_frame
from .websocket_server import DeviceGatewayController, LocalWebSocketGateway


def send_json(connection: socket.socket, value) -> None:
    connection.sendall(
        encode_frame(1, json.dumps(value, separators=(",", ":")).encode("utf-8"), mask=True)
    )


def connect_local(server: LocalWebSocketGateway) -> socket.socket:
    connection = socket.create_connection(server.server_address, timeout=3)
    key = base64.b64encode(os.urandom(16)).decode("ascii")
    request = (
        "GET /gateway HTTP/1.1\r\nHost: {0}:{1}\r\nUpgrade: websocket\r\n"
        "Connection: Upgrade\r\nSec-WebSocket-Key: {2}\r\n"
        "Sec-WebSocket-Version: 13\r\n\r\n"
    ).format(server.server_address[0], server.server_address[1], key)
    connection.sendall(request.encode("ascii"))
    response = b""
    while b"\r\n\r\n" not in response:
        response += connection.recv(4096)
    if b"101 Switching Protocols" not in response:
        raise RuntimeError("WebSocket upgrade failed")
    send_json(
        connection,
        {"type": "hello", "token": server.token, "protocolVersion": PROTOCOL_VERSION},
    )
    hello = json.loads(receive_frame(connection, require_mask=False).payload)
    if not hello.get("ok"):
        raise RuntimeError("gateway hello failed")
    return connection


def run(seconds: float) -> dict:
    controller = DeviceGatewayController(GatewayConfig(receive_timeout_seconds=1))
    server = LocalWebSocketGateway(controller)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    connection = None
    binary_count = 0
    first_sequence = None
    last_sequence = None
    stop_confirmation = None
    session_id = str(uuid.uuid4())
    try:
        connection = connect_local(server)
        send_json(
            connection,
            {"type": "start_acquisition", "requestId": "start", "sessionId": session_id},
        )
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            frame = receive_frame(connection, require_mask=False)
            if frame.opcode == 1:
                continue
            if frame.opcode != 2 or len(frame.payload) < EEG_CHUNK_HEADER.size:
                continue
            header = EEG_CHUNK_HEADER.unpack_from(frame.payload)
            if header[0] != b"BGEE" or header[1] != PROTOCOL_VERSION:
                raise RuntimeError("invalid EEG binary header")
            sequence = header[4]
            first_sequence = sequence if first_sequence is None else first_sequence
            last_sequence = sequence
            binary_count += 1
        send_json(connection, {"type": "stop_acquisition", "requestId": "stop"})
        while stop_confirmation is None:
            frame = receive_frame(connection, require_mask=False)
            if frame.opcode == 1:
                message = json.loads(frame.payload)
                if message.get("requestId") == "stop":
                    stop_confirmation = message.get("confirmation")
        return {
            "url": server.url,
            "sessionId": session_id,
            "binaryChunkCount": binary_count,
            "firstSequence": first_sequence,
            "lastSequence": last_sequence,
            "stopConfirmation": stop_confirmation,
            "droppedOutboundMessages": server.dropped_outbound_messages,
        }
    finally:
        if connection is not None:
            try:
                connection.sendall(encode_frame(8, b"", mask=True))
            except OSError:
                pass
            connection.close()
        controller.shutdown()
        server.shutdown()
        server.server_close()
        thread.join(1)


def main() -> int:
    parser = argparse.ArgumentParser(description="Real local WebSocket gateway smoke test.")
    parser.add_argument("--seconds", type=float, default=3.0)
    args = parser.parse_args()
    result = run(args.seconds)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["binaryChunkCount"] > 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())

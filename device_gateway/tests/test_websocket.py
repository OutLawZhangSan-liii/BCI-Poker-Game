import base64
import json
import os
import socket
import threading
import unittest
import uuid

from device_gateway.messages import PROTOCOL_VERSION
from device_gateway.websocket_protocol import encode_frame, receive_frame
from device_gateway.websocket_server import LocalWebSocketGateway


class FakeController:
    def __init__(self) -> None:
        self.running = False
        self.markers = []
        self.decisions = []
        self.models = []

    def get_status(self):
        return {"deviceState": "acquiring" if self.running else "idle"}

    def get_device_properties(self):
        return {"sample_rate_hz": 1000, "channel_count": 33}

    def start_acquisition(self, session_id, on_binary):
        self.running = True
        on_binary(b"binary-eeg")
        return "first_eeg"

    def stop_acquisition(self):
        self.running = False
        return "device_status"

    def disconnect(self):
        self.running = False

    def stimulus_marker(self, marker):
        self.markers.append(marker)
        return {"markerSampleIndex": "100", "gatewayMonotonicNs": 1}

    def bci_decision(self, decision):
        self.decisions.append(decision)

    def calibration_model(self, model):
        self.models.append(model)

    def shutdown(self):
        self.running = False


def connect_websocket(server):
    connection = socket.create_connection(server.server_address, timeout=2)
    key = base64.b64encode(os.urandom(16)).decode("ascii")
    request = (
        "GET /gateway HTTP/1.1\r\n"
        "Host: {}:{}\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        "Sec-WebSocket-Key: {}\r\n"
        "Sec-WebSocket-Version: 13\r\n\r\n"
    ).format(server.server_address[0], server.server_address[1], key)
    connection.sendall(request.encode("ascii"))
    response = b""
    while b"\r\n\r\n" not in response:
        response += connection.recv(4096)
    if b"101 Switching Protocols" not in response:
        raise AssertionError(response)
    return connection


def send_json(connection, value):
    connection.sendall(
        encode_frame(
            1,
            json.dumps(value, separators=(",", ":")).encode("utf-8"),
            mask=True,
        )
    )


class WebSocketGatewayTests(unittest.TestCase):
    def setUp(self) -> None:
        self.controller = FakeController()
        self.server = LocalWebSocketGateway(self.controller, token="test-token")
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(1)

    def test_rejects_wrong_token(self) -> None:
        connection = connect_websocket(self.server)
        try:
            send_json(
                connection,
                {"type": "hello", "token": "wrong", "protocolVersion": PROTOCOL_VERSION},
            )
            frame = receive_frame(connection, require_mask=False)
            result = json.loads(frame.payload)
            self.assertFalse(result["ok"])
        finally:
            connection.close()

    def test_control_and_binary_flow(self) -> None:
        connection = connect_websocket(self.server)
        try:
            send_json(
                connection,
                {"type": "hello", "token": "test-token", "protocolVersion": PROTOCOL_VERSION},
            )
            hello = json.loads(receive_frame(connection, require_mask=False).payload)
            self.assertTrue(hello["ok"])

            send_json(connection, {"type": "get_device_properties", "requestId": "p1"})
            properties = json.loads(receive_frame(connection, require_mask=False).payload)
            self.assertEqual(properties["data"]["sample_rate_hz"], 1000)

            session_id = str(uuid.uuid4())
            send_json(
                connection,
                {"type": "start_acquisition", "requestId": "s1", "sessionId": session_id},
            )
            frames = [receive_frame(connection, require_mask=False) for _ in range(2)]
            binary = next(frame for frame in frames if frame.opcode == 2)
            text = next(frame for frame in frames if frame.opcode == 1)
            self.assertEqual(binary.payload, b"binary-eeg")
            self.assertTrue(json.loads(text.payload)["ok"])

            send_json(connection, {"type": "stimulus_marker", "requestId": "m1", "sessionId": session_id, "markerType": "stimulus_start"})
            marker_result = json.loads(receive_frame(connection, require_mask=False).payload)
            self.assertTrue(marker_result["ok"])
            self.assertEqual(self.controller.markers[-1]["markerType"], "stimulus_start")
            self.assertEqual(marker_result["data"]["markerSampleIndex"], "100")

            send_json(connection, {"type": "bci_decision", "requestId": "d1", "sessionId": session_id, "trialId": "trial-1", "rejected": True})
            decision_result = json.loads(receive_frame(connection, require_mask=False).payload)
            self.assertTrue(decision_result["ok"])
            self.assertTrue(self.controller.decisions[-1]["rejected"])

            send_json(connection, {"type": "calibration_model", "requestId": "c1", "sessionId": session_id, "algorithm": "test"})
            model_result = json.loads(receive_frame(connection, require_mask=False).payload)
            self.assertTrue(model_result["ok"])
            self.assertEqual(self.controller.models[-1]["algorithm"], "test")

            send_json(connection, {"type": "stop_acquisition", "requestId": "x1"})
            stopped = json.loads(receive_frame(connection, require_mask=False).payload)
            self.assertEqual(stopped["confirmation"], "device_status")
        finally:
            connection.sendall(encode_frame(8, b"", mask=True))
            connection.close()

    def test_large_calibration_model_does_not_disconnect_gateway(self) -> None:
        connection = connect_websocket(self.server)
        try:
            send_json(
                connection,
                {"type": "hello", "token": "test-token", "protocolVersion": PROTOCOL_VERSION},
            )
            self.assertTrue(json.loads(receive_frame(connection, require_mask=False).payload)["ok"])

            session_id = str(uuid.uuid4())
            send_json(connection, {"type": "start_acquisition", "requestId": "s-large", "sessionId": session_id})
            frames = [receive_frame(connection, require_mask=False) for _ in range(2)]
            self.assertTrue(json.loads(next(frame for frame in frames if frame.opcode == 1).payload)["ok"])

            large_template = "x" * (128 * 1024)
            send_json(connection, {"type": "calibration_model", "requestId": "m-large", "sessionId": session_id,
                                   "algorithm": "etraca-prototype", "template": large_template})
            saved = json.loads(receive_frame(connection, require_mask=False).payload)
            self.assertTrue(saved["ok"])
            self.assertEqual(len(self.controller.models[-1]["template"]), len(large_template))

            send_json(connection, {"type": "get_status", "requestId": "still-connected"})
            status = json.loads(receive_frame(connection, require_mask=False).payload)
            self.assertTrue(status["ok"])
        finally:
            connection.close()

    def test_fragmented_calibration_model_does_not_disconnect_gateway(self) -> None:
        connection = connect_websocket(self.server)
        try:
            send_json(connection, {"type": "hello", "token": "test-token", "protocolVersion": PROTOCOL_VERSION})
            self.assertTrue(json.loads(receive_frame(connection, require_mask=False).payload)["ok"])
            session_id = str(uuid.uuid4())
            send_json(connection, {"type": "start_acquisition", "requestId": "s-fragment", "sessionId": session_id})
            frames = [receive_frame(connection, require_mask=False) for _ in range(2)]
            self.assertTrue(json.loads(next(frame for frame in frames if frame.opcode == 1).payload)["ok"])

            payload = json.dumps({"type": "calibration_model", "requestId": "m-fragment", "sessionId": session_id,
                                  "algorithm": "etraca-prototype", "template": "x" * (128 * 1024)},
                                 separators=(",", ":")).encode("utf-8")
            split = len(payload) // 2
            connection.sendall(encode_frame(1, payload[:split], mask=True, final=False))
            connection.sendall(encode_frame(0, payload[split:], mask=True, final=True))
            saved = json.loads(receive_frame(connection, require_mask=False).payload)
            self.assertTrue(saved["ok"])
            self.assertEqual(self.controller.models[-1]["algorithm"], "etraca-prototype")

            send_json(connection, {"type": "get_status", "requestId": "after-fragment"})
            self.assertTrue(json.loads(receive_frame(connection, require_mask=False).payload)["ok"])
        finally:
            connection.close()

    def test_only_one_client_can_claim_gateway(self) -> None:
        first = connect_websocket(self.server)
        send_json(
            first,
            {"type": "hello", "token": "test-token", "protocolVersion": PROTOCOL_VERSION},
        )
        receive_frame(first, require_mask=False)
        second = socket.create_connection(self.server.server_address, timeout=2)
        try:
            second.sendall(
                b"GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: x\r\nSec-WebSocket-Version: 13\r\n\r\n"
            )
            self.assertIn(b"503 Service Unavailable", second.recv(1024))
        finally:
            second.close()
            first.close()

    def test_non_loopback_binding_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "loopback"):
            LocalWebSocketGateway(self.controller, host="0.0.0.0")


if __name__ == "__main__":
    unittest.main()

import socket
import struct
import threading
import tempfile
import unittest
from pathlib import Path

from device_gateway import DeviceClient, GatewayConfig, LegacyBciAdapter
from device_gateway.capture import capture
from device_gateway.device_client import DeviceState
from device_gateway.transport import Transport


def response(attribute_id: int, value_count: int, payload: bytes) -> bytes:
    return b"\xAA" + bytes((attribute_id,)) + struct.pack("<HI", value_count, len(payload)) + payload + b"\x55"


class MockAcquisitionServer:
    def __init__(self, stream_on_start: bool = False) -> None:
        self.commands = []
        self.stream_on_start = stream_on_start
        self._ready = threading.Event()
        self._server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._server.bind(("127.0.0.1", 0))
        self.port = self._server.getsockname()[1]
        self._thread = threading.Thread(target=self._run, daemon=True)

    def start(self) -> None:
        self._server.listen(1)
        self._thread.start()
        self._ready.wait(1)

    def _run(self) -> None:
        self._ready.set()
        connection, _ = self._server.accept()
        with connection:
            while True:
                try:
                    command = connection.recv(4)
                except (ConnectionResetError, ConnectionAbortedError):
                    break
                if not command:
                    break
                self.commands.append(command)
                if command[:2] == b"\xA5\x01":
                    property_id = command[2]
                    if property_id == 5:
                        eeg_values = [float(value) for value in range(16)]
                        eeg_payload = struct.pack("<16f", *eeg_values)
                        frame = response(5, 16, eeg_payload)
                    elif property_id == 4:
                        payload = b"C3\0\0\0\0\0\0C4\0\0\0\0\0\0"
                        frame = response(4, 2, payload)
                    else:
                        values = {0: 0, 1: 250, 2: 8, 3: 2}
                        frame = response(property_id, 1, struct.pack("<I", values[property_id]))
                    # Deliberately split every response to exercise stream reassembly.
                    connection.sendall(frame[:3])
                    connection.sendall(frame[3:])
                elif command == bytes.fromhex("A5 10 01 5A") and self.stream_on_start:
                    eeg_values = [float(value) for value in range(16)]
                    eeg_payload = struct.pack("<16f", *eeg_values)
                    connection.sendall(response(5, 16, eeg_payload))
                    connection.sendall(response(5, 16, eeg_payload))
        self._server.close()

    def join(self) -> None:
        self._thread.join(1)


class IntegrationTests(unittest.TestCase):
    def test_tcp_property_and_control_flow(self) -> None:
        server = MockAcquisitionServer()
        server.start()
        config = GatewayConfig(port=server.port, receive_timeout_seconds=1)
        client = DeviceClient(config, LegacyBciAdapter(config.max_payload_bytes))
        try:
            client.connect()
            properties = client.query_properties()
            self.assertEqual(properties.sample_rate_hz, 250)
            self.assertEqual(properties.samples_per_packet, 8)
            self.assertEqual(properties.channel_count, 2)
            self.assertEqual(properties.lead_names, ("C3", "C4"))
            client.start_acquisition()
            self.assertEqual(client.state, DeviceState.ACQUIRING)
            client.stop_acquisition()
            self.assertEqual(client.state, DeviceState.IDLE)
        finally:
            client.close()
            server.join()
        self.assertEqual(server.commands[-2:], [bytes.fromhex("A5 10 01 5A"), bytes.fromhex("A5 10 02 5A")])

    def test_bounded_capture_saves_raw_frame_and_always_stops(self) -> None:
        server = MockAcquisitionServer(stream_on_start=True)
        server.start()
        config = GatewayConfig(port=server.port, receive_timeout_seconds=0.02)
        with tempfile.TemporaryDirectory(dir=".") as temporary_directory:
            metadata = capture(
                config,
                0.04,
                Path(temporary_directory),
                confirm_start_status=True,
            )
            session_directory = Path(temporary_directory) / metadata["session_id"]
            self.assertTrue(metadata["complete"])
            self.assertEqual(metadata["acquisition_status_after_start"], 0)
            self.assertEqual(metadata["eeg_frame_count"], 2)
            self.assertEqual(metadata["value_count_min"], 16)
            self.assertEqual(metadata["payload_bytes_min"], 64)
            self.assertEqual(metadata["stop_confirmation"], "device_status")
            self.assertTrue((session_directory / "device-frames.bin").is_file())
            self.assertTrue((session_directory / "capture.json").is_file())
        server.join()
        self.assertEqual(
            server.commands[-2:],
            [bytes.fromhex("A5 10 02 5A"), bytes.fromhex("A5 01 00 5A")],
        )

    def test_capture_can_explicitly_request_documented_eeg_property(self) -> None:
        server = MockAcquisitionServer()
        server.start()
        config = GatewayConfig(port=server.port, receive_timeout_seconds=0.02)
        with tempfile.TemporaryDirectory(dir=".") as temporary_directory:
            metadata = capture(
                config,
                0.04,
                Path(temporary_directory),
                request_eeg_property=True,
            )
            self.assertTrue(metadata["complete"])
            self.assertTrue(metadata["requested_eeg_property"])
        server.join()
        self.assertIn(bytes.fromhex("A5 01 05 5A"), server.commands)

    def test_reconnect_retries_without_replacing_client(self) -> None:
        class FlakyTransport(Transport):
            def __init__(self) -> None:
                self.connect_calls = 0

            def connect(self) -> None:
                self.connect_calls += 1
                if self.connect_calls < 3:
                    raise ConnectionError("not ready")

            def send_all(self, data: bytes) -> None:
                pass

            def receive(self, max_bytes: int) -> bytes:
                raise RuntimeError("not used")

            def close(self) -> None:
                pass

        transport = FlakyTransport()
        client = DeviceClient(GatewayConfig(), LegacyBciAdapter(), transport)
        client.reconnect(attempts=3, backoff_seconds=0)
        self.assertEqual(transport.connect_calls, 3)
        self.assertEqual(client.state, DeviceState.IDLE)


if __name__ == "__main__":
    unittest.main()

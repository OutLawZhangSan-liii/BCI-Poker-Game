import json
import os
import queue
import secrets
import socket
import socketserver
import sys
import threading
import time
import uuid
from dataclasses import asdict
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Protocol

from .config import GatewayConfig
from .device_client import DeviceClient, DeviceState
from .legacy_adapter import LegacyBciAdapter
from .messages import PROTOCOL_VERSION, command_result, encode_eeg_chunk, parse_json_message
from .session_writer import SessionWriter
from .stream import EegStreamBuffer
from .websocket_protocol import (
    WebSocketProtocolError,
    accept_upgrade,
    encode_frame,
    parse_upgrade_request,
    read_http_request,
    receive_message,
)


class GatewayController(Protocol):
    def get_status(self) -> Dict[str, Any]: ...
    def get_device_properties(self) -> Dict[str, Any]: ...
    def start_acquisition(self, session_id: str, on_binary: Callable[[bytes], None]) -> str: ...
    def stop_acquisition(self) -> str: ...
    def disconnect(self) -> None: ...
    def stimulus_marker(self, marker: Dict[str, Any]) -> Dict[str, Any]: ...
    def bci_decision(self, decision: Dict[str, Any]) -> None: ...
    def calibration_model(self, model: Dict[str, Any]) -> None: ...
    def shutdown(self) -> None: ...


class DeviceGatewayController:
    """Owns the single device socket and its receive thread."""

    def __init__(self, config: GatewayConfig) -> None:
        self.config = config
        self.adapter = LegacyBciAdapter(config.max_payload_bytes)
        self.client = DeviceClient(config, self.adapter)
        self.properties = None
        self.stream = None
        self.session_id = None
        self._reader = None
        self._reader_stop = threading.Event()
        self._lock = threading.RLock()
        self.last_error = None
        self._session_writer: Optional[SessionWriter] = None

    def _ensure_connected(self) -> None:
        if self.client.state in (DeviceState.DISCONNECTED, DeviceState.FAULTED):
            self.client.reconnect()
        if self.properties is None:
            self.properties = self.client.query_properties()

    def get_status(self) -> Dict[str, Any]:
        return {
            "deviceState": self.client.state.value,
            "sessionId": self.session_id,
            "lastError": self.last_error,
            "streamStats": None if self.stream is None else asdict(self.stream.stats),
        }

    def get_device_properties(self) -> Dict[str, Any]:
        with self._lock:
            self._ensure_connected()
            return asdict(self.properties)

    def start_acquisition(self, session_id: str, on_binary: Callable[[bytes], None]) -> str:
        uuid.UUID(session_id)
        with self._lock:
            self._ensure_connected()
            if self.client.state == DeviceState.ACQUIRING:
                raise RuntimeError("acquisition is already running")
            self.stream = EegStreamBuffer(
                self.properties.channel_count,
                self.properties.sample_rate_hz,
                self.properties.samples_per_packet,
                capacity_chunks=64,
            )
            self.session_id = session_id
            sessions_root = Path(os.environ.get("BRAIN_GAME_SESSIONS_DIR", "sessions"))
            self._session_writer = SessionWriter(
                sessions_root,
                session_id,
                asdict(self.properties),
                application_version="0.1.0-stage9",
                protocol_version=PROTOCOL_VERSION,
            )
            self.last_error = None
            self._reader_stop.clear()
            self.client.start_acquisition()
            self._reader = threading.Thread(
                target=self._read_loop,
                args=(on_binary,),
                name="eeg-device-reader",
                daemon=True,
            )
            self._reader.start()
            return "sent"

    def _read_loop(self, on_binary: Callable[[bytes], None]) -> None:
        try:
            while not self._reader_stop.is_set():
                try:
                    frames = self.client.receive_frames()
                except socket.timeout:
                    continue
                for frame in frames:
                    chunk = self.stream.ingest(frame, time.monotonic_ns())
                    if chunk is not None:
                        if self._session_writer is not None:
                            self._session_writer.write_eeg_chunk(chunk)
                        self.stream.pop()
                        on_binary(encode_eeg_chunk(self.session_id, chunk))
        except Exception as exc:
            self.last_error = "{}: {}".format(type(exc).__name__, exc)
            if self._session_writer is not None:
                self._session_writer.abort("device_read_error", self.last_error)
                self._session_writer = None
            self._reader_stop.set()

    def stop_acquisition(self) -> str:
        with self._lock:
            if self.client.state != DeviceState.ACQUIRING:
                return "already_stopped"
            self._reader_stop.set()
            confirmation = self.client.stop_acquisition(confirm=False)
            if self._reader is not None:
                self._reader.join(self.config.receive_timeout_seconds + 0.5)
            # No concurrent recv remains; status confirmation is now safe.
            time.sleep(0.5)
            try:
                status = self.adapter.decode_uint32_property(self.client.query_property(0))
                if status == 0:
                    confirmation = "device_status"
            except TimeoutError:
                confirmation = "sent"
            if self._session_writer is not None:
                self._session_writer.complete("acquisition_stopped")
                self._session_writer = None
            self.session_id = None
            return confirmation

    def disconnect(self) -> None:
        self.stop_acquisition()
        self.client.close()
        self.properties = None

    def stimulus_marker(self, marker: Dict[str, Any]) -> Dict[str, Any]:
        if self.session_id is None:
            raise RuntimeError("no active acquisition session")
        if self._session_writer is None:
            raise RuntimeError("session writer is not available")
        if str(marker.get("sessionId", "")) != self.session_id:
            raise ValueError("marker sessionId does not match active session")
        record = {
            key: value
            for key, value in marker.items()
            if key not in ("requestId", "type", "protocolVersion")
        }
        marker_ns = time.monotonic_ns()
        marker_sample_index = self.stream.estimate_sample_index(marker_ns) if self.stream is not None else 0
        record["gatewayMonotonicNs"] = marker_ns
        record["markerSampleIndex"] = marker_sample_index
        self._session_writer.write_marker(record)
        return {"gatewayMonotonicNs": marker_ns, "markerSampleIndex": str(marker_sample_index)}

    def bci_decision(self, decision: Dict[str, Any]) -> None:
        if self.session_id is None:
            raise RuntimeError("no active acquisition session")
        if self._session_writer is None:
            raise RuntimeError("session writer is not available")
        if str(decision.get("sessionId", "")) != self.session_id:
            raise ValueError("decision sessionId does not match active session")
        record = {
            key: value
            for key, value in decision.items()
            if key not in ("requestId", "type", "protocolVersion")
        }
        record["gatewayMonotonicNs"] = time.monotonic_ns()
        self._session_writer.write_decision(record)

    def calibration_model(self, model: Dict[str, Any]) -> None:
        if self.session_id is None or self._session_writer is None:
            raise RuntimeError("no active acquisition session")
        if str(model.get("sessionId", "")) != self.session_id:
            raise ValueError("model sessionId does not match active session")
        record = {key: value for key, value in model.items() if key not in ("requestId", "type", "protocolVersion", "sessionId")}
        self._session_writer.write_model(record)

    def shutdown(self) -> None:
        self.disconnect()


class _GatewayHandler(socketserver.BaseRequestHandler):
    def handle(self) -> None:
        server = self.server
        if self.client_address[0] not in ("127.0.0.1", "::1"):
            return
        if not server.claim_client():
            try:
                self.request.settimeout(server.handshake_timeout_seconds)
                read_http_request(self.request)
                self.request.sendall(
                    b"HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n"
                )
            except (ConnectionError, OSError, WebSocketProtocolError):
                pass
            return
        self._send_lock = threading.Lock()
        self._outbound = queue.Queue(maxsize=server.outbound_queue_size)
        self._writer_stop = threading.Event()
        self._writer = None
        self._authenticated = False
        try:
            self.request.settimeout(server.handshake_timeout_seconds)
            _, headers = parse_upgrade_request(read_http_request(self.request))
            accept_upgrade(self.request, headers)
            hello_frame = receive_message(self.request, server.max_hello_message_bytes)
            if hello_frame.opcode != 1:
                raise WebSocketProtocolError("first message must be a text hello")
            hello = parse_json_message(hello_frame.payload)
            if (
                hello.get("type") != "hello"
                or hello.get("token") != server.token
                or hello.get("protocolVersion") != PROTOCOL_VERSION
            ):
                self._send_json({"type": "hello_result", "ok": False, "protocolVersion": PROTOCOL_VERSION})
                return
            self._authenticated = True
            self.request.settimeout(None)
            self._send_json({"type": "hello_result", "ok": True, "protocolVersion": PROTOCOL_VERSION})
            self._writer = threading.Thread(target=self._write_binary_loop, daemon=True)
            self._writer.start()
            self._control_loop()
        except WebSocketProtocolError as exc:
            print("WebSocket gateway client closed: {}".format(exc), file=sys.stderr, flush=True)
        except (ConnectionError, OSError, ValueError):
            pass
        finally:
            self._writer_stop.set()
            if self._writer is not None:
                self._writer.join(0.5)
            try:
                if self._authenticated:
                    server.controller.stop_acquisition()
                self.request.sendall(encode_frame(8, b""))
            except (ConnectionError, OSError):
                pass
            server.release_client()

    def _send_json(self, value: Dict[str, Any]) -> None:
        payload = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        with self._send_lock:
            self.request.sendall(encode_frame(1, payload))

    def _enqueue_binary(self, payload: bytes) -> None:
        try:
            self._outbound.put_nowait(payload)
        except queue.Full:
            try:
                self._outbound.get_nowait()
            except queue.Empty:
                pass
            self.server.dropped_outbound_messages += 1
            self._outbound.put_nowait(payload)

    def _write_binary_loop(self) -> None:
        while not self._writer_stop.is_set():
            try:
                payload = self._outbound.get(timeout=0.1)
            except queue.Empty:
                continue
            try:
                with self._send_lock:
                    self.request.sendall(encode_frame(2, payload))
            except OSError:
                self._writer_stop.set()

    def _control_loop(self) -> None:
        while True:
            frame = receive_message(self.request, self.server.max_control_message_bytes)
            if frame.opcode == 8:
                return
            if frame.opcode == 9:
                with self._send_lock:
                    self.request.sendall(encode_frame(10, frame.payload))
                continue
            if frame.opcode != 1:
                raise WebSocketProtocolError("control messages must be text")
            message = parse_json_message(frame.payload)
            self._handle_command(message)

    def _handle_command(self, message: Dict[str, Any]) -> None:
        command = str(message.get("type", ""))
        request_id = str(message.get("requestId", ""))
        try:
            if command == "get_device_properties":
                data = self.server.controller.get_device_properties()
                result = command_result(request_id, command, True, "device_status", data=data)
            elif command == "get_status":
                result = command_result(request_id, command, True, "device_status", data=self.server.controller.get_status())
            elif command == "start_acquisition":
                session_id = str(message.get("sessionId") or uuid.uuid4())
                confirmation = self.server.controller.start_acquisition(session_id, self._enqueue_binary)
                result = command_result(request_id, command, True, confirmation, data={"sessionId": session_id})
            elif command == "stop_acquisition":
                confirmation = self.server.controller.stop_acquisition()
                result = command_result(request_id, command, True, confirmation)
            elif command == "disconnect":
                self.server.controller.disconnect()
                result = command_result(request_id, command, True, "device_status")
            elif command == "stimulus_marker":
                marker_data = self.server.controller.stimulus_marker(message)
                result = command_result(request_id, command, True, data=marker_data)
            elif command == "bci_decision":
                self.server.controller.bci_decision(message)
                result = command_result(request_id, command, True)
            elif command == "calibration_model":
                self.server.controller.calibration_model(message)
                result = command_result(request_id, command, True)
            elif command == "shutdown":
                self.server.controller.shutdown()
                result = command_result(request_id, command, True, "device_status")
            else:
                raise ValueError("unsupported command: {}".format(command))
        except Exception as exc:
            result = command_result(
                request_id,
                command,
                False,
                confirmation="sent",
                error={"code": type(exc).__name__, "message": str(exc)},
            )
        self._send_json(result)


class LocalWebSocketGateway(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(
        self,
        controller: GatewayController,
        host: str = "127.0.0.1",
        port: int = 0,
        token: Optional[str] = None,
        outbound_queue_size: int = 64,
    ) -> None:
        if host not in ("127.0.0.1", "::1", "localhost"):
            raise ValueError("gateway must bind to a loopback address")
        if outbound_queue_size <= 0:
            raise ValueError("outbound_queue_size must be positive")
        self.controller = controller
        self.token = token or secrets.token_urlsafe(32)
        self.outbound_queue_size = outbound_queue_size
        # eTRCA templates are intentionally persisted through an authenticated
        # control command. A two-target model is already about 120 KiB and a
        # future filter-bank/six-target model can be substantially larger.
        # Keep the unauthenticated hello small, while allowing bounded model
        # payloads after token authentication.
        self.max_hello_message_bytes = 16 * 1024
        self.max_control_message_bytes = 4 * 1024 * 1024
        self.handshake_timeout_seconds = 3.0
        self.dropped_outbound_messages = 0
        self._client_lock = threading.Lock()
        self._client_active = False
        super().__init__((host, port), _GatewayHandler)

    @property
    def url(self) -> str:
        return "ws://{}:{}".format(*self.server_address[:2])

    def claim_client(self) -> bool:
        with self._client_lock:
            if self._client_active:
                return False
            self._client_active = True
            return True

    def release_client(self) -> None:
        with self._client_lock:
            self._client_active = False

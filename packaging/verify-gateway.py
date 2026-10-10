"""Verify the distributed gateway without connecting to the EEG device."""
import json
import os
from pathlib import Path
import secrets
import queue
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from device_gateway.tests.test_websocket import connect_websocket, send_json
from device_gateway.websocket_protocol import receive_frame, encode_frame


def verify(executable):
    with tempfile.TemporaryDirectory(prefix="bci-gateway-") as directory:
        token = secrets.token_urlsafe(32)
        environment = dict(os.environ)
        # Deliberately exclude Node, Anaconda and all developer Python paths.
        environment["PATH"] = str(Path(os.environ["SystemRoot"]) / "System32")
        environment["BRAIN_GAME_GATEWAY_TOKEN"] = token
        environment["BRAIN_GAME_SESSIONS_DIR"] = str(Path(directory) / "sessions")
        environment["BRAIN_GAME_LOGS_DIR"] = str(Path(directory) / "logs")
        started = time.monotonic()
        process = subprocess.Popen([str(executable), "--port", "0"], cwd=directory,
            env=environment, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            output = queue.Queue()
            threading.Thread(target=lambda: output.put(process.stdout.readline()), daemon=True).start()
            ready = json.loads(output.get(timeout=10))
            assert ready["type"] == "gateway_ready", ready
            startup_ms = round((time.monotonic() - started) * 1000)
            url = urlparse(ready["url"])
            class ServerAddress:
                server_address = (url.hostname, url.port)
            connection = connect_websocket(ServerAddress())
            try:
                send_json(connection, {"type": "hello", "token": token,
                    "protocolVersion": ready["protocolVersion"]})
                hello = json.loads(receive_frame(connection, require_mask=False).payload)
                assert hello["ok"], hello
                # Status is a read-only command and does not connect/acquire EEG.
                send_json(connection, {"type": "get_status", "requestId": "package-status"})
                status = json.loads(receive_frame(connection, require_mask=False).payload)
                assert status["ok"], status
                connection.sendall(encode_frame(8, b"", mask=True))
            finally:
                connection.close()
            process.stdin.write("shutdown\n")
            process.stdin.flush()
            assert process.wait(timeout=5) == 0
            assert not list(Path(directory).rglob("*.bin"))
            print(json.dumps({"success": True, "startup_ms": startup_ms,
                "authenticated": True, "status": status["data"],
                "shutdown_exit": process.returncode, "no_developer_path": True}, ensure_ascii=False))
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)
            for stream in (process.stdin, process.stdout, process.stderr):
                stream.close()


if __name__ == "__main__":
    verify(Path(sys.argv[1]).resolve())

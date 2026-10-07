import argparse
import json
import os
import sys
import threading

from .config import GatewayConfig
from .messages import PROTOCOL_VERSION
from .websocket_server import DeviceGatewayController, LocalWebSocketGateway


def main() -> int:
    parser = argparse.ArgumentParser(description="Brain Game local device gateway sidecar.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=0)
    args = parser.parse_args()
    token = os.environ.get("BRAIN_GAME_GATEWAY_TOKEN")
    if not token:
        print("BRAIN_GAME_GATEWAY_TOKEN is required", file=sys.stderr)
        return 2
    controller = DeviceGatewayController(GatewayConfig())
    server = LocalWebSocketGateway(controller, host=args.host, port=args.port, token=token)

    def watch_stdin() -> None:
        for line in sys.stdin:
            if line.strip().lower() == "shutdown":
                server.shutdown()
                return

    threading.Thread(target=watch_stdin, name="shutdown-watcher", daemon=True).start()
    print(
        json.dumps(
            {"type": "gateway_ready", "url": server.url, "protocolVersion": PROTOCOL_VERSION},
            separators=(",", ":"),
        ),
        flush=True,
    )
    try:
        server.serve_forever()
    finally:
        controller.shutdown()
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

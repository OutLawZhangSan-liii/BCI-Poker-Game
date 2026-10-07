import argparse
import json
import sys
from dataclasses import asdict

from .config import GatewayConfig
from .device_client import DeviceClient
from .legacy_adapter import LegacyBciAdapter


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Check the local acquisition software and read device properties."
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=7110)
    parser.add_argument("--timeout", type=float, default=3.0)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    config = GatewayConfig(
        host=args.host,
        port=args.port,
        connect_timeout_seconds=args.timeout,
        receive_timeout_seconds=args.timeout,
    )
    client = DeviceClient(config, LegacyBciAdapter(config.max_payload_bytes))
    try:
        client.connect()
        properties = client.query_properties()
        print(json.dumps(asdict(properties), ensure_ascii=False, indent=2))
        return 0
    except (ConnectionError, OSError, TimeoutError, ValueError) as exc:
        print(
            "Acquisition software check failed at {}:{}: {}".format(
                config.host, config.port, exc
            ),
            file=sys.stderr,
        )
        return 1
    finally:
        client.close()


if __name__ == "__main__":
    sys.exit(main())


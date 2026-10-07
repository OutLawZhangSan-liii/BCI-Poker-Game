import argparse
import json
import socket
import sys
import time
import uuid
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from .config import GatewayConfig
from .device_client import DeviceClient, DeviceState
from .legacy_adapter import LegacyBciAdapter
from .session_writer import SessionWriter
from .stream import EegStreamBuffer


def record_session(config: GatewayConfig, duration_seconds: float, sessions_root: Path):
    if duration_seconds <= 0:
        raise ValueError("duration_seconds must be positive")
    session_id = "session-{}-{}".format(
        datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"), uuid.uuid4().hex[:8]
    )
    adapter = LegacyBciAdapter(config.max_payload_bytes)
    client = DeviceClient(config, adapter)
    writer = None
    stop_confirmation = None
    error = None
    try:
        client.connect()
        properties = client.query_properties()
        writer = SessionWriter(
            sessions_root,
            session_id,
            asdict(properties),
            protocol_version=1,
        )
        stream = EegStreamBuffer(
            properties.channel_count,
            properties.sample_rate_hz,
            properties.samples_per_packet,
            capacity_chunks=8,
        )
        client.start_acquisition()
        started_at = time.monotonic()
        while time.monotonic() - started_at < duration_seconds:
            try:
                frames = client.receive_frames()
            except socket.timeout:
                continue
            for frame in frames:
                chunk = stream.ingest(frame, time.monotonic_ns())
                if chunk is not None:
                    writer.write_eeg_chunk(chunk)
                    stream.pop()
        stop_confirmation = client.stop_acquisition(confirm=True, grace_seconds=0.5)
        writer.write_event(
            "acquisition_stopped",
            {
                "confirmation": stop_confirmation,
                "streamStats": asdict(stream.stats),
            },
        )
        if stream.stats.valid_eeg_frames == 0:
            raise RuntimeError("no valid EEG frames were received")
        writer.complete("duration_elapsed")
        return {
            "sessionId": session_id,
            "directory": str(writer.directory.resolve()),
            "stopConfirmation": stop_confirmation,
            "streamStats": asdict(stream.stats),
        }
    except Exception as exc:
        error = "{}: {}".format(type(exc).__name__, exc)
        if writer is not None:
            writer.abort("recording_failed", error)
        raise
    finally:
        if client.state == DeviceState.ACQUIRING:
            try:
                client.stop_acquisition(confirm=True, grace_seconds=0.5)
            except Exception:
                pass
        client.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Record one versioned local EEG session.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=7110)
    parser.add_argument("--seconds", type=float, default=10.0)
    parser.add_argument("--output", type=Path, default=Path("sessions"))
    parser.add_argument("--timeout", type=float, default=1.0)
    args = parser.parse_args()
    config = GatewayConfig(
        host=args.host,
        port=args.port,
        connect_timeout_seconds=args.timeout,
        receive_timeout_seconds=args.timeout,
    )
    try:
        print(
            json.dumps(
                record_session(config, args.seconds, args.output),
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0
    except Exception as exc:
        print("Session recording failed: {}".format(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

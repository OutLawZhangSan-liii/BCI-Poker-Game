import argparse
import json
import os
import socket
import sys
import time
import uuid
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict

from .config import GatewayConfig
from .device_client import DeviceClient
from .eeg_decoder import EEG_SAMPLE_UNIT
from .legacy_adapter import LegacyBciAdapter
from .stream import EegStreamBuffer


def capture(
    config: GatewayConfig,
    duration_seconds: float,
    output_directory: Path,
    request_eeg_property: bool = False,
    confirm_start_status: bool = False,
) -> Dict[str, Any]:
    if duration_seconds <= 0:
        raise ValueError("duration_seconds must be positive")

    adapter = LegacyBciAdapter(config.max_payload_bytes)
    client = DeviceClient(config, adapter)
    session_id = "capture-{}-{}".format(
        datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"), uuid.uuid4().hex[:8]
    )
    session_directory = output_directory / session_id
    session_directory.mkdir(parents=True, exist_ok=False)
    raw_temp = session_directory / "device-frames.bin.tmp"
    raw_final = session_directory / "device-frames.bin"
    metadata_temp = session_directory / "capture.json.tmp"
    metadata_final = session_directory / "capture.json"

    frame_count = 0
    invalid_eeg_frames = 0
    value_count_min = None
    value_count_max = None
    payload_bytes_min = None
    payload_bytes_max = None
    started_at = None
    stopped_at = None
    properties = None
    stream = None
    acquisition_status_after_start = None
    start_confirmation_error = None
    error = None
    stop_confirmation = None

    try:
        client.connect()
        properties = client.query_properties()
        stream = EegStreamBuffer(
            channel_count=properties.channel_count,
            sample_rate_hz=properties.sample_rate_hz,
            samples_per_packet=properties.samples_per_packet,
            capacity_chunks=8,
        )
        client.start_acquisition()
        if confirm_start_status:
            try:
                acquisition_status_after_start = adapter.decode_uint32_property(
                    client.query_property(0)
                )
            except TimeoutError as confirmation_exc:
                # Some acquisition software does not answer property queries while
                # streaming. First valid EEG remains the fallback confirmation.
                start_confirmation_error = str(confirmation_exc)
        if request_eeg_property:
            client.transport.send_all(adapter.query_property_command(adapter.EEG_ATTRIBUTE_ID))
        started_at = time.monotonic()
        deadline = started_at + duration_seconds
        with raw_temp.open("wb") as raw_file:
            while time.monotonic() < deadline:
                try:
                    frames = client.receive_frames()
                except socket.timeout:
                    continue
                for frame in frames:
                    if frame.attribute_id != adapter.EEG_ATTRIBUTE_ID:
                        continue
                    chunk = stream.ingest(frame, time.monotonic_ns())
                    if chunk is None:
                        invalid_eeg_frames += 1
                        continue
                    # The session writer consumes immediately; the bounded queue
                    # remains representative of downstream backpressure.
                    stream.pop()
                    raw_file.write(chunk.raw_frame)
                    frame_count += 1
                    value_count_min = frame.value_count if value_count_min is None else min(value_count_min, frame.value_count)
                    value_count_max = frame.value_count if value_count_max is None else max(value_count_max, frame.value_count)
                    payload_length = len(frame.payload)
                    payload_bytes_min = payload_length if payload_bytes_min is None else min(payload_bytes_min, payload_length)
                    payload_bytes_max = payload_length if payload_bytes_max is None else max(payload_bytes_max, payload_length)
            raw_file.flush()
            os.fsync(raw_file.fileno())
    except Exception as exc:
        error = "{}: {}".format(type(exc).__name__, exc)
        raise
    finally:
        if client.state.value == "acquiring":
            try:
                stop_confirmation = client.stop_acquisition(
                    confirm=True,
                    grace_seconds=0.5,
                )
            except Exception as stop_exc:
                if error is None:
                    error = "stop failed: {}".format(stop_exc)
        stopped_at = time.monotonic()
        client.close()

        if started_at is not None and frame_count == 0 and error is None:
            error = "no valid EEG frames were received"

        metadata = {
            "session_id": session_id,
            "complete": error is None and frame_count > 0,
            "error": error,
            "requested_duration_seconds": duration_seconds,
            "actual_duration_seconds": None if started_at is None else stopped_at - started_at,
            "properties": None if properties is None else asdict(properties),
            "acquisition_status_after_start": acquisition_status_after_start,
            "start_confirmation_error": start_confirmation_error,
            "requested_eeg_property": request_eeg_property,
            "confirmed_start_status": confirm_start_status,
            "eeg_frame_count": frame_count,
            "invalid_eeg_frame_count": invalid_eeg_frames,
            "value_count_min": value_count_min,
            "value_count_max": value_count_max,
            "payload_bytes_min": payload_bytes_min,
            "payload_bytes_max": payload_bytes_max,
            "raw_frame_file": raw_final.name,
            "sample_encoding_assumption": "float32-le",
            "sample_unit": EEG_SAMPLE_UNIT,
            "stream_stats": None if stream is None else asdict(stream.stats),
            "stop_confirmation": stop_confirmation,
        }
        with metadata_temp.open("w", encoding="utf-8", newline="\n") as metadata_file:
            json.dump(metadata, metadata_file, ensure_ascii=False, indent=2)
            metadata_file.write("\n")
            metadata_file.flush()
            os.fsync(metadata_file.fileno())
        os.replace(str(metadata_temp), str(metadata_final))
        if raw_temp.exists():
            os.replace(str(raw_temp), str(raw_final))

    if frame_count == 0:
        raise RuntimeError(error or "no valid EEG frames were received")
    return metadata


def main() -> int:
    parser = argparse.ArgumentParser(description="Capture a bounded real EEG frame sample safely.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=7110)
    parser.add_argument("--seconds", type=float, default=10.0)
    parser.add_argument("--output", type=Path, default=Path("captures"))
    parser.add_argument("--timeout", type=float, default=1.0)
    parser.add_argument(
        "--request-eeg-property",
        action="store_true",
        help="Send one documented property-05 query after acquisition starts.",
    )
    parser.add_argument(
        "--confirm-start-status",
        action="store_true",
        help="Query property 0 after start (not used by the legacy baseline).",
    )
    args = parser.parse_args()
    config = GatewayConfig(
        host=args.host,
        port=args.port,
        connect_timeout_seconds=args.timeout,
        receive_timeout_seconds=args.timeout,
    )
    try:
        result = capture(
            config,
            args.seconds,
            args.output,
            request_eeg_property=args.request_eeg_property,
            confirm_start_status=args.confirm_start_status,
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        print("EEG capture failed: {}".format(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

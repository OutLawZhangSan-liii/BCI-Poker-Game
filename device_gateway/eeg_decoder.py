import struct
from dataclasses import dataclass
from typing import List, Sequence

from .protocol import DeviceFrame

EEG_SAMPLE_UNIT = "μV"  # Acquisition software output; confirmed by the user.


@dataclass(frozen=True)
class EegBlock:
    channels: Sequence[Sequence[float]]
    channel_count: int
    samples_per_channel: int
    sample_encoding: str = "float32-le"
    sample_unit: str = EEG_SAMPLE_UNIT


def decode_eeg_frame(frame: DeviceFrame, channel_count: int) -> EegBlock:
    if channel_count <= 0:
        raise ValueError("channel_count must be positive")
    if len(frame.payload) != frame.value_count * 4:
        raise ValueError("EEG payload length does not equal value_count * 4")
    if frame.value_count % channel_count:
        raise ValueError("EEG value count is not divisible by channel count")

    values = struct.unpack("<{}f".format(frame.value_count), frame.payload)
    samples_per_channel = frame.value_count // channel_count
    channels: List[List[float]] = [[] for _ in range(channel_count)]
    for sample_index in range(samples_per_channel):
        base = sample_index * channel_count
        for channel_index in range(channel_count):
            channels[channel_index].append(values[base + channel_index])
    return EegBlock(channels, channel_count, samples_per_channel)

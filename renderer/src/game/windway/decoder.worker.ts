import { WindwayDecoder } from "./decoder";
import type { WindowMode } from "./flight";

export interface InputPacket { fs: number; mode: WindowMode; channels: Float32Array[]; receivedAt: number }
let decoder: WindwayDecoder | undefined;
self.onmessage = ({data}: MessageEvent<InputPacket>) => {
  try {
    decoder ??= new WindwayDecoder(data.fs, data.mode);
    decoder.push(data.channels, (vote, index) => {
      const ageMs = (data.channels[0].length - index - 1) * 1000 / data.fs;
      self.postMessage({...vote, at: data.receivedAt - ageMs});
    });
  } catch {
    self.postMessage({error: "脑电数据异常，飞行已暂停"});
  }
};

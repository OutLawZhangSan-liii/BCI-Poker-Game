export const GATEWAY_PROTOCOL_VERSION = 1;
export const EEG_CHUNK_HEADER_BYTES = 60;

export interface EegChunk {
  protocolVersion: number; sessionId: string; gatewaySequence: bigint;
  firstSampleIndex: bigint; gatewayMonotonicNs: bigint; sampleRateHz: number;
  channelCount: number; sampleCountPerChannel: number;
  // Acquisition software output is already μV; parsing never rescales samples.
  transportGapSuspected: boolean; samples: Float32Array;
}

function uuidFromBytes(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function parseEegChunk(buffer: ArrayBuffer): EegChunk {
  if (buffer.byteLength < EEG_CHUNK_HEADER_BYTES) throw new Error("EEG binary message is shorter than its header");
  const bytes = new Uint8Array(buffer);
  if (String.fromCharCode(...bytes.slice(0, 4)) !== "BGEE") throw new Error("invalid EEG binary magic");
  const view = new DataView(buffer);
  const protocolVersion = view.getUint16(4, true);
  const messageType = view.getUint16(6, true);
  if (protocolVersion !== GATEWAY_PROTOCOL_VERSION || messageType !== 1) throw new Error("unsupported EEG binary protocol");
  const channelCount = view.getUint16(52, true);
  const sampleCountPerChannel = view.getUint16(54, true);
  const expectedBytes = EEG_CHUNK_HEADER_BYTES + channelCount * sampleCountPerChannel * 4;
  if (buffer.byteLength !== expectedBytes) throw new Error(`EEG payload length mismatch: expected ${expectedBytes}, got ${buffer.byteLength}`);
  return {
    protocolVersion, sessionId: uuidFromBytes(bytes.slice(8, 24)),
    gatewaySequence: view.getBigUint64(24, true), firstSampleIndex: view.getBigUint64(32, true),
    gatewayMonotonicNs: view.getBigUint64(40, true), sampleRateHz: view.getUint32(48, true),
    channelCount, sampleCountPerChannel, transportGapSuspected: Boolean(view.getUint32(56, true) & 1),
    samples: new Float32Array(buffer.slice(EEG_CHUNK_HEADER_BYTES)),
  };
}

export function extractChannel(chunk: EegChunk, channelIndex: number): Float32Array {
  if (channelIndex < 0 || channelIndex >= chunk.channelCount) throw new RangeError("channel index is outside this EEG chunk");
  const channel = new Float32Array(chunk.sampleCountPerChannel);
  for (let sample = 0; sample < chunk.sampleCountPerChannel; sample += 1) channel[sample] = chunk.samples[sample * chunk.channelCount + channelIndex];
  return channel;
}

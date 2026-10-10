import { DEFAULT_DISPLAY_LEAD } from "../bci/signal/leads";
import type { EegChunk } from "../bci/protocol";
import { computePowerSpectrumWithConfig, type PowerSpectrum } from "./simulatedAnalysis";
import { ObservationFilter, observationFilterInfo, type ObservationFilterInfo, type ObservationSignalMode } from "./observationFilter";

export const REAL_EEG_WINDOW_SECONDS = 2;
export const REAL_EEG_MAX_BUFFER_SECONDS = 10;
export const REAL_EEG_DATA_TIMEOUT_MS = 1_500;
export const REAL_EEG_MAX_SAMPLE_RATE_HZ = 10_000;
export const REAL_EEG_MAX_CHANNEL_COUNT = 256;
export const REAL_EEG_MAX_BUFFER_SAMPLES = 1_000_000;
export const REAL_EEG_MAX_FFT_LENGTH = 1 << 22;

export type RealEegBufferState = "waiting" | "accumulating" | "running" | "paused" | "interrupted" | "invalid";

export interface RealEegConfiguration {
  sessionId: string;
  sampleRateHz: number;
  channelCount: number;
  channelIndex: number;
  /** Optional packet size used to derive a device-appropriate timeout. */
  samplesPerPacket?: number;
}

export interface RealEegSnapshot {
  state: RealEegBufferState;
  notice: string | null;
  historyNotice: string | null;
  sampleRateHz: number | null;
  windowSamples: number;
  fftLength: number;
  sampleCount: number;
  samples: Float32Array;
  windowStartSample: bigint | null;
  windowEndSampleExclusive: bigint | null;
  lastDataAtMs: number | null;
  version: number;
  processing?: ObservationSignalMode;
  filterInfo?: ObservationFilterInfo | null;
  notchEnabled?: boolean;
}

export interface RealEegAcceptResult {
  accepted: boolean;
  reason?: string;
}

export interface RealEegTap {
  acceptChunk: (chunk: EegChunk) => void;
  invalidate: () => void;
}

export function resolveRealEegChannelIndex(names: readonly string[], currentIndex: number, previousName: string | null, initialized: boolean): number {
  const preferred = names.findIndex((name) => name.trim().toUpperCase() === DEFAULT_DISPLAY_LEAD.toUpperCase());
  if (!initialized) return preferred >= 0 ? preferred : 0;
  if (previousName) {
    const preserved = names.findIndex((name) => name.trim() === previousName);
    if (preserved >= 0) return preserved;
  }
  if (currentIndex >= 0 && currentIndex < names.length) return currentIndex;
  return preferred >= 0 ? preferred : 0;
}

const nextPowerOfTwo = (value: number) => {
  let result = 1;
  while (result < value && result < REAL_EEG_MAX_FFT_LENGTH) result <<= 1;
  return result;
};

/** A bounded, session-scoped continuous EEG tap. It never feeds the formal Worker. */
export class RealEegAnalysisBuffer {
  private configuration: RealEegConfiguration | null = null;
  private data = new Float32Array();
  private filteredData = new Float32Array();
  private notchedData = new Float32Array();
  private filter: ObservationFilter | null = null;
  private length = 0;
  private bufferStartSample: bigint | null = null;
  private lastEndSample: bigint | null = null;
  private lastSequence: bigint | null = null;
  private lastDataAtMs: number | null = null;
  private state: RealEegBufferState = "waiting";
  private notice: string | null = null;
  private historyNotice: string | null = null;
  private version = 0;
  private accepting = false;

  configure(configuration: RealEegConfiguration): void {
    const windowSamples = Math.round(REAL_EEG_WINDOW_SECONDS * configuration.sampleRateHz);
    const fftLength = nextPowerOfTwo(windowSamples);
    const samplesPerPacket = configuration.samplesPerPacket ?? 0;
    if (!configuration.sessionId || !Number.isFinite(configuration.sampleRateHz) || configuration.sampleRateHz <= 0 || configuration.sampleRateHz > REAL_EEG_MAX_SAMPLE_RATE_HZ || !Number.isInteger(configuration.channelCount) || configuration.channelCount <= 0 || configuration.channelCount > REAL_EEG_MAX_CHANNEL_COUNT || !Number.isInteger(configuration.channelIndex) || configuration.channelIndex < 0 || configuration.channelIndex >= configuration.channelCount || !Number.isInteger(samplesPerPacket) || samplesPerPacket < 0 || samplesPerPacket > REAL_EEG_MAX_BUFFER_SAMPLES || windowSamples < 2 || windowSamples > REAL_EEG_MAX_BUFFER_SAMPLES || fftLength < windowSamples || fftLength > REAL_EEG_MAX_FFT_LENGTH) {
      throw new Error("实时 EEG 元数据无效，无法配置观察");
    }
    this.configuration = { ...configuration, samplesPerPacket };
    this.data = new Float32Array(Math.min(Math.max(2, Math.round(configuration.sampleRateHz * REAL_EEG_MAX_BUFFER_SECONDS)), REAL_EEG_MAX_BUFFER_SAMPLES));
    this.filteredData = new Float32Array(this.data.length);
    this.notchedData = new Float32Array(this.data.length);
    this.filter = observationFilterInfo(configuration.sampleRateHz) ? new ObservationFilter(configuration.sampleRateHz) : null;
    this.resetSession("waiting");
    this.accepting = true;
  }

  /** Clear only the analysis window while retaining sequence continuity guards. */
  clearWindow(state: RealEegBufferState = "waiting", notice: string | null = null): void {
    this.length = 0;
    this.filter?.reset();
    this.bufferStartSample = null;
    this.state = state;
    this.notice = notice;
    if ((state === "interrupted" || state === "invalid") && notice) this.historyNotice = notice;
    this.version += 1;
  }

  /** End the current observation epoch and forget sequence/session records. */
  resetSession(state: RealEegBufferState = "waiting", notice: string | null = null): void {
    this.clearWindow(state, notice);
    this.lastEndSample = null;
    this.lastSequence = null;
    this.lastDataAtMs = null;
    this.historyNotice = null;
    this.accepting = false;
  }

  clear(state: RealEegBufferState = "waiting", notice: string | null = null): void {
    this.resetSession(state, notice);
  }

  invalidate(state: RealEegBufferState = "waiting", notice = "实时观察已失效，等待当前采集会话的数据。"): void {
    this.configuration = null;
    this.resetSession(state, notice);
  }

  pause(): void {
    this.accepting = false;
    this.clearWindow("paused", "实时观察已暂停；继续后将重新积累连续窗口。");
    this.lastEndSample = null;
    this.lastSequence = null;
    this.lastDataAtMs = null;
  }

  resume(): void {
    this.clearWindow("waiting");
    this.lastEndSample = null;
    this.lastSequence = null;
    this.lastDataAtMs = null;
    this.accepting = this.configuration !== null;
  }

  private timeoutMs(): number {
    const configuration = this.configuration;
    if (!configuration || !configuration.samplesPerPacket) return REAL_EEG_DATA_TIMEOUT_MS;
    // Allow two nominal packet periods, while retaining the historical 1.5 s floor.
    return Math.max(REAL_EEG_DATA_TIMEOUT_MS, (configuration.samplesPerPacket / configuration.sampleRateHz) * 1000 * 2);
  }

  private markTimeout(): void {
    const timeoutMs = this.timeoutMs();
    this.clearWindow("interrupted", `超过 ${(timeoutMs / 1000).toFixed(1)} 秒未收到 EEG 数据，已清空窗口并等待恢复。`);
    // Keep lastSequence/lastEndSample so a delayed duplicate cannot be replayed.
    this.lastDataAtMs = null;
  }

  checkTimeout(nowMs: number): boolean {
    if (this.lastDataAtMs === null || nowMs - this.lastDataAtMs <= this.timeoutMs()) return false;
    this.markTimeout();
    return true;
  }

  acceptChunk(chunk: EegChunk, nowMs: number): RealEegAcceptResult {
    const configuration = this.configuration;
    if (!configuration || !this.accepting) return { accepted: false, reason: "实时观察未处于接收状态" };
    if (chunk.sessionId !== configuration.sessionId) return { accepted: false, reason: "旧会话数据已拒绝" };
    if (this.lastDataAtMs !== null && nowMs - this.lastDataAtMs > this.timeoutMs()) this.markTimeout();
    if (this.state === "invalid" || this.state === "interrupted") this.notice = null;
    if (chunk.sampleRateHz !== configuration.sampleRateHz || chunk.channelCount !== configuration.channelCount || chunk.sampleCountPerChannel <= 0 || chunk.samples.length !== chunk.channelCount * chunk.sampleCountPerChannel) {
      this.configuration = null;
      this.resetSession("invalid", "实时 EEG 元数据与当前设备属性不一致，已停止本窗口分析。");
      return { accepted: false, reason: "实时 EEG 元数据不一致" };
    }
    const firstSample = chunk.firstSampleIndex;
    const endSample = firstSample + BigInt(chunk.sampleCountPerChannel);
    let continuityNotice: string | null = null;
    if (this.lastSequence !== null) {
      const sequenceGap = chunk.gatewaySequence !== this.lastSequence + 1n;
      const overlap = this.lastEndSample !== null && firstSample < this.lastEndSample;
      const forwardGap = this.lastEndSample !== null && firstSample > this.lastEndSample;
      if (chunk.gatewaySequence <= this.lastSequence || overlap) {
        this.clearWindow("interrupted", "检测到重复或逆序 EEG 数据块，已丢弃并重新积累。");
        return { accepted: false, reason: "重复或逆序数据块" };
      }
      if (sequenceGap || forwardGap || chunk.transportGapSuspected) {
        continuityNotice = "检测到数据连续性中断，未补零拼接，已从当前块重新积累。";
        this.clearWindow("accumulating", continuityNotice);
        this.historyNotice = continuityNotice;
      }
    } else if (chunk.transportGapSuspected) {
      continuityNotice = "网关标记传输间隔异常，未补零拼接，已从当前块重新积累。";
      this.clearWindow("accumulating", continuityNotice);
      this.historyNotice = continuityNotice;
    }
    const values = new Float32Array(chunk.sampleCountPerChannel);
    for (let sample = 0; sample < chunk.sampleCountPerChannel; sample += 1) {
      const value = chunk.samples[sample * chunk.channelCount + configuration.channelIndex];
      if (!Number.isFinite(value)) {
        this.clearWindow("invalid", "所选通道出现非有限样本，已拒绝该数据块并重新积累。");
        return { accepted: false, reason: "非有限样本" };
      }
      values[sample] = value;
    }
    const filtered = this.filter?.process(values);
    const bandpassed = filtered?.bandpassed ?? values, notched = filtered?.notched ?? values;
    if (this.length === 0) this.bufferStartSample = firstSample;
    const capacity = this.data.length;
    if (values.length >= capacity) {
      this.data.set(values.slice(values.length - capacity));
      this.filteredData.set(bandpassed.subarray(bandpassed.length - capacity));
      this.notchedData.set(notched.subarray(notched.length - capacity));
      this.length = capacity;
      this.bufferStartSample = endSample - BigInt(capacity);
    } else {
      const overflow = Math.max(0, this.length + values.length - capacity);
      if (overflow) {
        this.data.copyWithin(0, overflow, this.length);
        this.filteredData.copyWithin(0, overflow, this.length);
        this.notchedData.copyWithin(0, overflow, this.length);
        this.length -= overflow;
        if (this.bufferStartSample !== null) this.bufferStartSample += BigInt(overflow);
      }
      this.data.set(values, this.length);
      this.filteredData.set(bandpassed, this.length);
      this.notchedData.set(notched, this.length);
      this.length += values.length;
    }
    this.lastSequence = chunk.gatewaySequence;
    this.lastEndSample = endSample;
    this.lastDataAtMs = nowMs;
    const windowSamples = Math.round(REAL_EEG_WINDOW_SECONDS * configuration.sampleRateHz);
    if (this.length >= windowSamples) {
      this.state = "running";
      // A complete, newly contiguous window supersedes any stale interruption
      // message; retain the message separately as historyNotice.
      this.notice = null;
    } else if (this.state !== "paused") {
      this.state = "accumulating";
    }
    this.version += 1;
    return { accepted: true };
  }

  snapshot(visibleOnly = false, processing: ObservationSignalMode = "raw", notchEnabled = false): RealEegSnapshot {
    const configuration = this.configuration;
    const windowSamples = configuration ? Math.round(REAL_EEG_WINDOW_SECONDS * configuration.sampleRateHz) : 0;
    const sampleCount = this.length;
    // The observation renderer only needs its visible window, never a 10-second copy.
    const effectiveMode = this.filter && processing === "filtered" ? "filtered" : "raw";
    const useNotch = effectiveMode === "filtered" && notchEnabled && Boolean(this.filter?.info.notchAvailable);
    const source = effectiveMode === "raw" ? this.data : useNotch ? this.notchedData : this.filteredData;
    const samples = source.slice(visibleOnly ? Math.max(0, sampleCount - windowSamples) : 0, sampleCount);
    const windowStartSample = this.bufferStartSample === null ? null : this.bufferStartSample + BigInt(Math.max(0, sampleCount - windowSamples));
    const windowEndSampleExclusive = windowStartSample === null ? null : windowStartSample + BigInt(Math.min(sampleCount, windowSamples));
    return {
      state: this.state,
      notice: this.notice,
      historyNotice: this.historyNotice,
      sampleRateHz: configuration?.sampleRateHz ?? null,
      windowSamples,
      fftLength: configuration ? nextPowerOfTwo(windowSamples) : 0,
      sampleCount,
      samples,
      windowStartSample,
      windowEndSampleExclusive,
      lastDataAtMs: this.lastDataAtMs,
      version: this.version,
      processing: effectiveMode,
      filterInfo: this.filter?.info ?? null,
      notchEnabled: useNotch,
    };
  }

  get currentVersion(): number { return this.version; }
}

export function computeRealEegSpectrum(snapshot: RealEegSnapshot): PowerSpectrum | null {
  if (snapshot.sampleCount < snapshot.windowSamples || snapshot.windowSamples < 2 || !snapshot.sampleRateHz) return null;
  return computePowerSpectrumWithConfig(snapshot.samples.slice(-snapshot.windowSamples), snapshot.sampleRateHz, snapshot.fftLength);
}

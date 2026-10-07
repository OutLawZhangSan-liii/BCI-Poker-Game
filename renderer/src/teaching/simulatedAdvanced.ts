import {
  computePowerSpectrumWithConfig,
  generateNoiseSample,
  generateSimulatedSample,
  getSimulatedPreset,
  type PowerSpectrum,
  type SimulatedPreset,
  SIMULATED_SAMPLE_RATE_HZ,
} from "./simulatedAnalysis";

export interface KnownComponentSnr {
  signalPower: number;
  noisePower: number;
  snrDb: number | null;
  state: "finite" | "no-noise" | "no-signal" | "undefined" | "invalid" | "incomplete";
}

export function computeKnownComponentSnr(clean: ArrayLike<number>, noise: ArrayLike<number>): KnownComponentSnr {
  if (clean.length === 0 || clean.length !== noise.length) return { signalPower: 0, noisePower: 0, snrDb: null, state: "incomplete" };
  let signalPower = 0;
  let noisePower = 0;
  for (let index = 0; index < clean.length; index += 1) {
    const signal = Number(clean[index]);
    const noiseValue = Number(noise[index]);
    if (!Number.isFinite(signal) || !Number.isFinite(noiseValue)) return { signalPower, noisePower, snrDb: null, state: "invalid" };
    signalPower += signal * signal;
    noisePower += noiseValue * noiseValue;
  }
  signalPower /= clean.length;
  noisePower /= clean.length;
  if (signalPower === 0 && noisePower === 0) return { signalPower, noisePower, snrDb: null, state: "undefined" };
  if (noisePower === 0) return { signalPower, noisePower, snrDb: Number.POSITIVE_INFINITY, state: "no-noise" };
  if (signalPower === 0) return { signalPower, noisePower, snrDb: Number.NEGATIVE_INFINITY, state: "no-signal" };
  const snrDb = 10 * Math.log10(signalPower / noisePower);
  return Number.isFinite(snrDb) ? { signalPower, noisePower, snrDb, state: "finite" } : { signalPower, noisePower, snrDb: null, state: "invalid" };
}

export type TemporalSignalMode = "static" | "transition12to15";

/** A deterministic, teaching-only frequency transition at five seconds. */
export function generateTemporalCleanSample(sampleIndex: number, amplitudeScale = 1, mode: TemporalSignalMode = "static") {
  if (mode === "static") return generateSimulatedSample(sampleIndex, getSimulatedPreset("single12"), amplitudeScale);
  const switchSample = Math.round(SIMULATED_SAMPLE_RATE_HZ * 5);
  const frequency = sampleIndex < switchSample ? 12 : 15;
  const phaseAtSwitch = 2 * Math.PI * 12 * (switchSample / SIMULATED_SAMPLE_RATE_HZ);
  const timeAfterSwitch = Math.max(0, sampleIndex - switchSample) / SIMULATED_SAMPLE_RATE_HZ;
  const phase = sampleIndex < switchSample ? 2 * Math.PI * 12 * sampleIndex / SIMULATED_SAMPLE_RATE_HZ : phaseAtSwitch + 2 * Math.PI * 15 * timeAfterSwitch;
  return amplitudeScale * Math.sin(phase);
}

export function generateTemporalSignalBlock(startSampleIndex: number, count: number, amplitudeScale: number, noiseSigma: number, noiseSeed: number, mode: TemporalSignalMode): { clean: Float32Array; noise: Float32Array; observed: Float32Array } {
  const length = Math.max(0, count);
  const clean = new Float32Array(length);
  const noise = new Float32Array(length);
  const observed = new Float32Array(length);
  for (let offset = 0; offset < length; offset += 1) {
    const sampleIndex = startSampleIndex + offset;
    const cleanSample = generateTemporalCleanSample(sampleIndex, amplitudeScale, mode);
    const noiseSample = generateNoiseSample(sampleIndex, noiseSeed, noiseSigma);
    clean[offset] = cleanSample;
    noise[offset] = noiseSample;
    observed[offset] = cleanSample + noiseSample;
  }
  return { clean, noise, observed };
}

export interface TimeFrequencyColumn {
  centerTimeSeconds: number;
  startSample: number;
  endSampleExclusive: number;
  spectrum: PowerSpectrum;
}

export interface TimeFrequencyHistory {
  samples: Float32Array;
  sampleStart: number;
  nextWindowStart: number;
  columns: TimeFrequencyColumn[];
}

export function createTimeFrequencyHistory(sampleStart = 0): TimeFrequencyHistory {
  return { samples: new Float32Array(), sampleStart, nextWindowStart: sampleStart, columns: [] };
}

/** Append one contiguous block and calculate only newly available windows. */
export function appendTimeFrequencyHistory(
  history: TimeFrequencyHistory,
  block: ArrayLike<number>,
  blockStartSample: number,
  sampleRateHz: number,
  windowSamples: number,
  stepSamples = 64,
  maxHistorySeconds = 30,
): TimeFrequencyHistory {
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0 || !Number.isInteger(windowSamples) || windowSamples < 2 || !Number.isInteger(stepSamples) || stepSamples < 1 || block.length === 0) return history;
  const expectedStart = history.sampleStart + history.samples.length;
  if (history.samples.length > 0 && blockStartSample !== expectedStart) return createTimeFrequencyHistory(blockStartSample);
  const combined = new Float32Array(history.samples.length + block.length);
  combined.set(history.samples);
  for (let index = 0; index < block.length; index += 1) combined[history.samples.length + index] = Number(block[index]);
  history.samples = combined;
  const endSample = history.sampleStart + history.samples.length;
  while (history.nextWindowStart + windowSamples <= endSample) {
    const localStart = history.nextWindowStart - history.sampleStart;
    const window = history.samples.slice(localStart, localStart + windowSamples);
    const spectrum = computePowerSpectrumWithConfig(window, sampleRateHz, 2 ** Math.ceil(Math.log2(windowSamples)));
    if (spectrum) history.columns.push({ centerTimeSeconds: (history.nextWindowStart + (windowSamples - 1) / 2) / sampleRateHz, startSample: history.nextWindowStart, endSampleExclusive: history.nextWindowStart + windowSamples, spectrum });
    history.nextWindowStart += stepSamples;
  }
  const maxSamples = Math.ceil(maxHistorySeconds * sampleRateHz) + windowSamples;
  if (history.samples.length > maxSamples) {
    const drop = history.samples.length - maxSamples;
    history.samples = history.samples.slice(drop);
    history.sampleStart += drop;
  }
  const newestCenter = history.columns.at(-1)?.centerTimeSeconds;
  if (newestCenter !== undefined) history.columns = history.columns.filter((column) => newestCenter - column.centerTimeSeconds <= maxHistorySeconds);
  return history;
}

export function computeTimeFrequencyColumns(samples: ArrayLike<number>, sampleRateHz: number, windowSamples: number, stepSamples = 64, maxHistorySeconds = 30, originSampleIndex = 0): TimeFrequencyColumn[] {
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0 || !Number.isInteger(windowSamples) || windowSamples < 2 || !Number.isInteger(stepSamples) || stepSamples < 1 || samples.length < windowSamples) return [];
  const firstAllowed = Math.max(0, samples.length - Math.ceil(maxHistorySeconds * sampleRateHz) - windowSamples);
  const columns: TimeFrequencyColumn[] = [];
  for (let start = firstAllowed; start + windowSamples <= samples.length; start += stepSamples) {
    const window = Array.from({ length: windowSamples }, (_, index) => Number(samples[start + index]));
    const spectrum = computePowerSpectrumWithConfig(window, sampleRateHz, 2 ** Math.ceil(Math.log2(windowSamples)));
    if (spectrum) columns.push({ centerTimeSeconds: (originSampleIndex + start + (windowSamples - 1) / 2) / sampleRateHz, startSample: originSampleIndex + start, endSampleExclusive: originSampleIndex + start + windowSamples, spectrum });
  }
  return columns;
}

export interface Stage8SimulationScenario {
  id: "snr-low" | "snr-high" | "snr-loud" | "tf-stable12" | "tf-transition";
  label: string;
  amplitudeScale: number;
  noiseSigma: number;
  temporalMode: TemporalSignalMode;
}

export const SNR_TEACHING_SCENARIOS: Stage8SimulationScenario[] = [
  { id: "snr-low", label: "低噪声", amplitudeScale: 1, noiseSigma: 0.2, temporalMode: "static" },
  { id: "snr-high", label: "高噪声", amplitudeScale: 1, noiseSigma: 1, temporalMode: "static" },
  { id: "snr-loud", label: "提高信号幅值", amplitudeScale: 2, noiseSigma: 1, temporalMode: "static" },
];

export const TIME_FREQUENCY_TEACHING_SCENARIOS: Stage8SimulationScenario[] = [
  { id: "tf-stable12", label: "稳定 12 Hz", amplitudeScale: 1, noiseSigma: 0, temporalMode: "static" },
  { id: "tf-transition", label: "12 Hz 转 15 Hz", amplitudeScale: 1, noiseSigma: 0, temporalMode: "transition12to15" },
];

export const stage8ScenarioById = (id: Stage8SimulationScenario["id"]) => [...SNR_TEACHING_SCENARIOS, ...TIME_FREQUENCY_TEACHING_SCENARIOS].find((scenario) => scenario.id === id);

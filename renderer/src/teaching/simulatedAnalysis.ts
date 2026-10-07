export const SIMULATED_SAMPLE_RATE_HZ = 256;
export const SIMULATED_WINDOW_SAMPLES = 512;
export const SIMULATED_FFT_LENGTH = 512;
export const SIMULATED_FREQUENCY_BIN_HZ = SIMULATED_SAMPLE_RATE_HZ / SIMULATED_FFT_LENGTH;

export interface SimulatedComponent { frequencyHz: number; amplitude: number; phaseRad?: number; }
export interface SimulatedPreset { id: "single12" | "single15" | "dual" | "harmonics"; label: string; components: SimulatedComponent[]; }
export interface SimulatedSignalBlock { clean: Float32Array; noise: Float32Array; observed: Float32Array; }
export type NoiseTeachingScenarioId = "noise-clean" | "noise-added" | "noise-weak";
export interface NoiseTeachingScenario { id: NoiseTeachingScenarioId; label: string; presetId: SimulatedPreset["id"]; amplitudeScale: number; noiseSigma: number; }
export const DEFAULT_SIMULATED_NOISE_SEED = 20260831;
export const SIMULATED_PRESETS: SimulatedPreset[] = [
  { id: "single12", label: "12 Hz 单一正弦", components: [{ frequencyHz: 12, amplitude: 1 }] },
  { id: "single15", label: "15 Hz 单一正弦", components: [{ frequencyHz: 15, amplitude: 1 }] },
  { id: "dual", label: "12 Hz ＋ 15 Hz 双频混合", components: [{ frequencyHz: 12, amplitude: 0.7 }, { frequencyHz: 15, amplitude: 0.7 }] },
  { id: "harmonics", label: "12 Hz 基频 ＋ 24/36 Hz 谐波", components: [{ frequencyHz: 12, amplitude: 1 }, { frequencyHz: 24, amplitude: 0.5 }, { frequencyHz: 36, amplitude: 0.33 }] },
];

export const getSimulatedPreset = (id: SimulatedPreset["id"]) => SIMULATED_PRESETS.find((preset) => preset.id === id) ?? SIMULATED_PRESETS[0];
export const NOISE_TEACHING_SCENARIOS: NoiseTeachingScenario[] = [
  { id: "noise-clean", label: "场景 1：干净信号", presetId: "single12", amplitudeScale: 1, noiseSigma: 0 },
  { id: "noise-added", label: "场景 2：加入噪声", presetId: "single12", amplitudeScale: 1, noiseSigma: 1 },
  { id: "noise-weak", label: "场景 3：信号减弱", presetId: "single12", amplitudeScale: 0.2, noiseSigma: 1 },
];

export const noiseTeachingScenarioById = (id: NoiseTeachingScenarioId) => NOISE_TEACHING_SCENARIOS.find((scenario) => scenario.id === id) ?? NOISE_TEACHING_SCENARIOS[0];

export function generateSimulatedSample(sampleIndex: number, preset: SimulatedPreset, amplitudeScale = 1) {
  return preset.components.reduce((sum, component) => sum + amplitudeScale * component.amplitude * Math.sin(2 * Math.PI * component.frequencyHz * sampleIndex / SIMULATED_SAMPLE_RATE_HZ + (component.phaseRad ?? 0)), 0);
}

export function generateSimulatedSamples(startSampleIndex: number, count: number, preset: SimulatedPreset, amplitudeScale = 1) {
  return Float32Array.from({ length: Math.max(0, count) }, (_, offset) => generateSimulatedSample(startSampleIndex + offset, preset, amplitudeScale));
}

/** A stateless seeded uniform generator, keyed by sample index so block boundaries never alter the sequence. */
export function seededUniform(seed: number, sampleIndex: number) {
  let value = (Math.trunc(seed) ^ Math.imul(Math.trunc(sampleIndex) + 1, 0x9e3779b9)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad) >>> 0;
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97) >>> 0;
  return ((value ^ (value >>> 15)) >>> 0) / 0x1_0000_0000;
}

export function generateNoiseSample(sampleIndex: number, seed: number, sigma = 0) {
  if (!Number.isFinite(sigma) || sigma === 0) return 0;
  return sigma * Math.sqrt(3) * (2 * seededUniform(seed, sampleIndex) - 1);
}

export function generateSimulatedSignalBlock(startSampleIndex: number, count: number, preset: SimulatedPreset, amplitudeScale = 1, noiseSigma = 0, noiseSeed = DEFAULT_SIMULATED_NOISE_SEED): SimulatedSignalBlock {
  const length = Math.max(0, count);
  const clean = new Float32Array(length);
  const noise = new Float32Array(length);
  const observed = new Float32Array(length);
  for (let offset = 0; offset < length; offset += 1) {
    const sampleIndex = startSampleIndex + offset;
    const cleanSample = generateSimulatedSample(sampleIndex, preset, amplitudeScale);
    const noiseSample = generateNoiseSample(sampleIndex, noiseSeed, noiseSigma);
    clean[offset] = cleanSample;
    noise[offset] = noiseSample;
    observed[offset] = cleanSample + noiseSample;
  }
  return { clean, noise, observed };
}

export function nextSimulatedNoiseSeed(seed: number) {
  return ((Math.imul(Math.trunc(seed) >>> 0, 1664525) + 1013904223) >>> 0);
}

export function periodicHann(length: number) {
  return Float64Array.from({ length }, (_, index) => 0.5 * (1 - Math.cos(2 * Math.PI * index / length)));
}

function fftReal(values: Float64Array) {
  const length = values.length;
  const real = Float64Array.from(values); const imaginary = new Float64Array(length);
  for (let i = 1, j = 0; i < length; i += 1) {
    let bit = length >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [real[i], real[j]] = [real[j], real[i]]; }
  }
  for (let size = 2; size <= length; size <<= 1) {
    const angle = -2 * Math.PI / size; const half = size >> 1;
    for (let start = 0; start < length; start += size) for (let offset = 0; offset < half; offset += 1) {
      const phase = angle * offset; const cosine = Math.cos(phase); const sine = Math.sin(phase);
      const even = start + offset; const odd = even + half;
      const oddReal = real[odd] * cosine - imaginary[odd] * sine;
      const oddImaginary = real[odd] * sine + imaginary[odd] * cosine;
      real[odd] = real[even] - oddReal; imaginary[odd] = imaginary[even] - oddImaginary;
      real[even] += oddReal; imaginary[even] += oddImaginary;
    }
  }
  return { real, imaginary };
}

export interface PowerSpectrum { frequenciesHz: Float64Array; powerDensity: Float64Array; mean: number; windowEnergy: number; frequencyBinHz: number; invalidSamples: number; }

/**
 * Teaching-only PSD primitive.  The sample window may be zero padded to a
 * radix-2 FFT length, while the Hann energy and mean are always based on the
 * actual (un-padded) samples.
 */
export function computePowerSpectrumWithConfig(samples: ArrayLike<number>, sampleRateHz: number, fftLength: number): PowerSpectrum | null {
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0 || !Number.isInteger(fftLength) || fftLength < samples.length || fftLength < 2 || (fftLength & (fftLength - 1)) !== 0 || samples.length < 2) return null;
  let invalidSamples = 0;
  const values = Float64Array.from({ length: samples.length }, (_, index) => {
    if (Number.isFinite(samples[index])) return Number(samples[index]);
    invalidSamples += 1;
    return 0;
  });
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const window = periodicHann(values.length); const windowed = Float64Array.from(values, (value, index) => (value - mean) * window[index]);
  const fftInput = new Float64Array(fftLength); fftInput.set(windowed);
  const { real, imaginary } = fftReal(fftInput); const halfLength = fftLength / 2;
  const windowEnergy = window.reduce((sum, value) => sum + value * value, 0);
  const frequencyBinHz = sampleRateHz / fftLength;
  const frequenciesHz = Float64Array.from({ length: halfLength + 1 }, (_, index) => index * frequencyBinHz);
  const powerDensity = Float64Array.from({ length: halfLength + 1 }, (_, index) => {
    const value = (real[index] * real[index] + imaginary[index] * imaginary[index]) / (sampleRateHz * Math.max(windowEnergy, 1e-12));
    return index === 0 || index === halfLength ? value : value * 2;
  });
  return { frequenciesHz, powerDensity, mean, windowEnergy, frequencyBinHz, invalidSamples };
}

export function computePowerSpectrum(samples: ArrayLike<number>): PowerSpectrum | null {
  if (samples.length !== SIMULATED_FFT_LENGTH) return null;
  return computePowerSpectrumWithConfig(samples, SIMULATED_SAMPLE_RATE_HZ, SIMULATED_FFT_LENGTH);
}

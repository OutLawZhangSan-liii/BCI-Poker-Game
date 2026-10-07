import type { PowerSpectrum } from "./simulatedAnalysis";

/** Per-consumer workspace. Same demeaned, periodic-Hann, one-sided PSD definition. */
export class ReusableSpectrum {
  private length = 0;
  private fftLength = 0;
  private rate = 0;
  private real = new Float64Array();
  private imaginary = new Float64Array();
  private window = new Float64Array();
  private cosine = new Float64Array();
  private sine = new Float64Array();
  private frequencies = new Float64Array();
  private power = new Float64Array();
  private energy = 0;
  compute(samples: ArrayLike<number>, rate: number, fftLength: number): PowerSpectrum | null {
    const length = samples.length;
    if (!Number.isFinite(rate) || rate <= 0 || length < 2 || fftLength < length || !Number.isInteger(fftLength) || (fftLength & (fftLength - 1))) return null;
    if (this.length !== length || this.fftLength !== fftLength || this.rate !== rate) {
      this.length = length; this.fftLength = fftLength; this.rate = rate;
      this.real = new Float64Array(fftLength); this.imaginary = new Float64Array(fftLength);
      this.window = new Float64Array(length); this.energy = 0;
      for (let i = 0; i < length; i++) { const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / length)); this.window[i] = w; this.energy += w * w; }
      this.cosine = new Float64Array(fftLength / 2); this.sine = new Float64Array(fftLength / 2);
      for (let i = 0; i < fftLength / 2; i++) { this.cosine[i] = Math.cos(-2 * Math.PI * i / fftLength); this.sine[i] = Math.sin(-2 * Math.PI * i / fftLength); }
      this.frequencies = new Float64Array(fftLength / 2 + 1); this.power = new Float64Array(fftLength / 2 + 1);
      for (let i = 0; i < this.frequencies.length; i++) this.frequencies[i] = i * rate / fftLength;
    }
    let sum = 0, invalidSamples = 0;
    for (let i = 0; i < length; i++) { if (Number.isFinite(samples[i])) sum += Number(samples[i]); else invalidSamples++; }
    const mean = sum / length, real = this.real, imaginary = this.imaginary;
    for (let i = 0; i < length; i++) real[i] = ((Number.isFinite(samples[i]) ? Number(samples[i]) : 0) - mean) * this.window[i];
    real.fill(0, length); imaginary.fill(0);
    for (let i = 1, j = 0; i < fftLength; i++) {
      let bit = fftLength >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { const value = real[i]; real[i] = real[j]; real[j] = value; }
    }
    for (let size = 2; size <= fftLength; size <<= 1) {
      const half = size >> 1, stride = fftLength / size;
      for (let start = 0; start < fftLength; start += size) for (let offset = 0; offset < half; offset++) {
        const phase = offset * stride, even = start + offset, odd = even + half;
        const r = real[odd] * this.cosine[phase] - imaginary[odd] * this.sine[phase];
        const im = real[odd] * this.sine[phase] + imaginary[odd] * this.cosine[phase];
        real[odd] = real[even] - r; imaginary[odd] = imaginary[even] - im;
        real[even] += r; imaginary[even] += im;
      }
    }
    for (let i = 0; i < this.power.length; i++) {
      const value = (real[i] * real[i] + imaginary[i] * imaginary[i]) / (rate * Math.max(this.energy, 1e-12));
      this.power[i] = i === 0 || i === fftLength / 2 ? value : value * 2;
    }
    // Only this small metadata object changes; typed buffers remain owned by the consumer.
    return { frequenciesHz: this.frequencies, powerDensity: this.power, mean, windowEnergy: this.energy, frequencyBinHz: rate / fftLength, invalidSamples };
  }
}

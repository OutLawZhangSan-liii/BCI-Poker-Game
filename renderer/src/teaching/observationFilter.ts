export type ObservationSignalMode = "raw" | "filtered";
export interface ObservationFilterInfo { lowHz: number; highHz: number; notchAvailable: boolean; }

// Display-only causal SOS filters. Coefficients follow the bilinear biquad
// formulae: https://www.w3.org/TR/audio-eq-cookbook/. No classifier uses these.
class Biquad {
  private b0: number; private b1: number; private b2: number;
  private a1: number; private a2: number;
  private z1 = 0; private z2 = 0; private initialized = false;
  private dcGain: number;
  constructor(kind: "highpass" | "lowpass" | "notch", rate: number, hz: number, q: number) {
    const omega = 2 * Math.PI * hz / rate, cosine = Math.cos(omega), alpha = Math.sin(omega) / (2 * q);
    const a0 = 1 + alpha;
    const b0 = kind === "highpass" ? (1 + cosine) / 2 : kind === "lowpass" ? (1 - cosine) / 2 : 1;
    const b1 = kind === "highpass" ? -(1 + cosine) : kind === "lowpass" ? 1 - cosine : -2 * cosine;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b0 / a0;
    this.a1 = -2 * cosine / a0; this.a2 = (1 - alpha) / a0;
    this.dcGain = kind === "highpass" ? 0 : 1;
  }
  reset() { this.z1 = this.z2 = 0; this.initialized = false; }
  process(value: number): number {
    if (!this.initialized) {
      // Start at the first sample's DC equilibrium, avoiding a large artificial
      // step when an electrode has a substantial static offset.
      this.z1 = (this.dcGain - this.b0) * value;
      this.z2 = (this.b2 - this.a2 * this.dcGain) * value;
      this.initialized = true;
    }
    const output = this.b0 * value + this.z1;
    this.z1 = this.b1 * value - this.a1 * output + this.z2;
    this.z2 = this.b2 * value - this.a2 * output;
    return output;
  }
}

export function observationFilterInfo(rate: number): ObservationFilterInfo | null {
  const lowHz = 2, highHz = Math.min(45, rate * .45);
  if (!Number.isFinite(rate) || highHz <= lowHz) return null;
  return { lowHz, highHz, notchAvailable: rate > 100 };
}

/** One selected channel, with state retained across packets and view switches. */
export class ObservationFilter {
  readonly info: ObservationFilterInfo;
  private sections: Biquad[];
  private notch: Biquad | null;
  constructor(rate: number) {
    const info = observationFilterInfo(rate);
    if (!info) throw new Error("sample rate is too low for observation filtering");
    this.info = info;
    const q = [1 / (2 * Math.cos(Math.PI / 8)), 1 / (2 * Math.cos(3 * Math.PI / 8))];
    this.sections = [...q.map(value => new Biquad("highpass", rate, info.lowHz, value)),
      ...q.map(value => new Biquad("lowpass", rate, info.highHz, value))];
    this.notch = info.notchAvailable ? new Biquad("notch", rate, 50, 30) : null;
  }
  reset() { this.sections.forEach(section => section.reset()); this.notch?.reset(); }
  process(samples: Float32Array): { bandpassed: Float32Array; notched: Float32Array } {
    const bandpassed = new Float32Array(samples.length), notched = new Float32Array(samples.length);
    for (let index = 0; index < samples.length; index++) {
      let value = samples[index];
      for (const section of this.sections) value = section.process(value);
      bandpassed[index] = value;
      // Keep this state warm even when the optional notch is not selected.
      notched[index] = this.notch ? this.notch.process(value) : value;
    }
    return { bandpassed, notched };
  }
}

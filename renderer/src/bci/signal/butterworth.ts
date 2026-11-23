/** Trial-only causal fourth-order HP + fourth-order LP Butterworth bank.
 * Zero SOS state after subtracting the first sample, matching the offline sosfilt protocol. */
export class ContinuousButterworthBank {
  private coefficients: number[][][];
  private states: Float64Array[][];
  private offsets: number[] | null = null;
  readonly sampleRateHz: number;
  readonly channelCount: number;
  constructor(sampleRateHz: number, channelCount: number) {
    this.sampleRateHz = sampleRateHz; this.channelCount = channelCount;
    if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 90 || !Number.isInteger(channelCount) || channelCount < 1) throw new Error("invalid Butterworth bank configuration");
    const section = (hz: number, highpass: boolean, q: number) => {
      const w = 2 * Math.PI * hz / sampleRateHz, c = Math.cos(w), alpha = Math.sin(w) / (2 * q), a0 = 1 + alpha;
      const b = (highpass ? 1 + c : 1 - c) / 2;
      return [b / a0, (highpass ? -(1 + c) : 1 - c) / a0, b / a0, -2 * c / a0, (1 - alpha) / a0];
    };
    const qs = [1 / (2 * Math.cos(Math.PI / 8)), 1 / (2 * Math.cos(3 * Math.PI / 8))];
    this.coefficients = [6, 14].map(low => [...qs.map(q => section(low, true, q)), ...qs.map(q => section(45, false, q))]);
    this.states = this.coefficients.map(() => Array.from({ length: channelCount }, () => new Float64Array(8)));
  }
  reset(): void { this.states.forEach(bank => bank.forEach(channel => channel.fill(0))); this.offsets = null; }
  process(channels: Float32Array[]): Float64Array[][] {
    if (channels.length !== this.channelCount || channels.some(c => c.length !== channels[0].length || c.some(v => !Number.isFinite(v)))) throw new Error("invalid Butterworth samples");
    const count = channels[0].length;
    if (count && !this.offsets) this.offsets = channels.map(c => c[0]);
    const output = this.coefficients.map(() => channels.map(() => new Float64Array(count)));
    for (let bank = 0; bank < 2; bank++) for (let ch = 0; ch < this.channelCount; ch++) {
      const state = this.states[bank][ch];
      for (let n = 0; n < count; n++) {
        let value = channels[ch][n] - this.offsets![ch];
        for (let s = 0; s < 4; s++) {
          const [b0, b1, b2, a1, a2] = this.coefficients[bank][s], j = 2 * s;
          const y = b0 * value + state[j];
          state[j] = b1 * value - a1 * y + state[j + 1]; state[j + 1] = b2 * value - a2 * y; value = y;
        }
        output[bank][ch][n] = value;
      }
    }
    return output;
  }
}

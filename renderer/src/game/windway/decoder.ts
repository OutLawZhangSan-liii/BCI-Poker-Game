import { rankScores, scoreFilteredBanks } from "../../bci/signal/fbcca";
import { targetHz, type Direction, type WindowMode } from "./flight";

// Fourth-order Chebyshev I, 0.5 dB ripple. Two conjugate pole pairs per cutoff.
// Prewarp before the bilinear transform; normalize each cascade at DC or Nyquist.
export function chebyshevSections(fs: number, cutoff: number, high: boolean) {
  const rippleGain = 10 ** (-.5 / 20);
  const mu = Math.asinh(1 / Math.sqrt(10 ** .05 - 1)) / 4;
  const warp = Math.tan(Math.PI * cutoff / fs);
  return [3, 1].map((k, index) => {
    const angle = k * Math.PI / 8;
    const real = -Math.sinh(mu) * Math.sin(angle), imag = Math.cosh(mu) * Math.cos(angle);
    const scale = high ? warp / (real * real + imag * imag) : warp;
    const u = real * scale, v = imag * scale;
    const denominator = (1 - u) ** 2 + v * v;
    const a1 = -2 * (1 - u * u - v * v) / denominator;
    const a2 = ((1 + u) ** 2 + v * v) / denominator;
    const gain = (1 + (high ? -a1 : a1) + a2) / 4 * (index === 0 ? rippleGain : 1);
    return [gain, (high ? -2 : 2) * gain, gain, a1, a2];
  });
}
export interface Vote { dir: Direction; window: 1 | 2 }
export class WindwayDecoder {
  private readonly ring: Float64Array[][];
  private readonly sections: number[][][];
  private readonly states: Float64Array[][];
  private readonly capacity: number;
  private readonly stride: number;
  private nextVote: number;
  private samples = 0;
  private offsets: number[] = [];
  private previous: Direction[] = [0, 0];
  private readonly fs: number;
  private readonly mode: WindowMode;
  constructor(fs: number, mode: WindowMode) {
    if (!Number.isInteger(fs) || fs <= 90) throw new Error("采样率须高于 90 Hz");
    this.fs = fs; this.mode = mode; this.capacity = 2 * fs;
    this.stride = Math.round(.25 * fs);
    this.nextVote = Math.round(.5 * fs) + (mode === "fixed" ? 2 : 1) * fs;
    this.sections = [6, 14].map(low => [...chebyshevSections(fs, low, true), ...chebyshevSections(fs, 45, false)]);
    this.ring = this.sections.map(() => Array.from({length: 4}, () => new Float64Array(this.capacity * 2)));
    this.states = this.sections.map(() => Array.from({length: 4}, () => new Float64Array(8)));
  }
  private vote(seconds: 1 | 2): Direction {
    const end = this.samples % this.capacity + this.capacity;
    const windows = this.ring.map(bank => bank.map(row => row.subarray(end - seconds * this.fs, end)));
    const result = rankScores(scoreFilteredBanks(windows, this.fs, [...targetHz], 2, undefined, false));
    const dir = result.confidence >= (seconds === 1 ? .70 : .55) && result.margin >= .08
      ? (result.candidateIndex === 0 ? -1 : 1) : 0;
    const confirmed = this.previous[seconds - 1] === dir ? dir : 0;
    this.previous[seconds - 1] = dir;
    return confirmed;
  }
  push(channels: Float32Array[], emit: (vote: Vote, offset: number) => void) {
    if (channels.length !== 4 || channels.some(c => c.length !== channels[0].length)) throw new Error("导联数据不完整");
    if (!channels[0].length) return;
    if (!this.samples) this.offsets = channels.map(c => c[0]);
    for (let i = 0; i < channels[0].length; i++) {
      const slot = this.samples % this.capacity;
      for (let ch = 0; ch < 4; ch++) {
        const sample = channels[ch][i] - this.offsets[ch];
        if (!Number.isFinite(sample)) throw new Error("EEG 采样无效");
        for (let b = 0; b < 2; b++) {
          const state = this.states[b][ch]; let x = sample;
          for (let j = 0; j < 4; j++) {
            const [b0,b1,b2,a1,a2] = this.sections[b][j], s = 2 * j;
            const y = b0*x + state[s];
            state[s] = b1*x - a1*y + state[s+1]; state[s+1] = b2*x - a2*y; x = y;
          }
          this.ring[b][ch][slot] = this.ring[b][ch][slot + this.capacity] = x;
        }
      }
      this.samples++;
      if (this.samples !== this.nextVote) continue;
      this.nextVote += this.stride;
      const fast = this.mode === "dynamic" ? this.vote(1) : 0;
      const slow = this.samples >= Math.round(2.5 * this.fs) ? this.vote(2) : 0;
      emit({dir: fast || slow, window: fast ? 1 : 2}, i);
    }
  }
}

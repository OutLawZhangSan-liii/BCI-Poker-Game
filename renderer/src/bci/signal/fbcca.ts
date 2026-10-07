export interface FrequencyScore { frequencyHz: number; score: number; }

type Matrix = number[][];

const FILTER_LENGTH = 257;
const FILTER_HIGH_HZ = 45;
const filterCache = new Map<string, Float64Array>();
export const FBCCA_FILTER_WARMUP_SAMPLES = FILTER_LENGTH - 1;

function sinc(value: number): number {
  return Math.abs(value) < 1e-12 ? 1 : Math.sin(Math.PI * value) / (Math.PI * value);
}

/** Deterministic linear-phase FIR. The 45 Hz ceiling removes 50 Hz before CCA. */
function bandpassTaps(sampleRateHz: number, lowHz: number, highHz: number): Float64Array {
  const key = `${sampleRateHz}:${lowHz}:${highHz}:${FILTER_LENGTH}`;
  const cached = filterCache.get(key); if (cached) return cached;
  if (!(0 < lowHz && lowHz < highHz && highHz < sampleRateHz / 2)) throw new Error("invalid FIR bandpass bounds");
  const taps = new Float64Array(FILTER_LENGTH), midpoint = (FILTER_LENGTH - 1) / 2;
  for (let index = 0; index < FILTER_LENGTH; index += 1) {
    const offset = index - midpoint;
    const high = 2 * highHz / sampleRateHz * sinc(2 * highHz / sampleRateHz * offset);
    const low = 2 * lowHz / sampleRateHz * sinc(2 * lowHz / sampleRateHz * offset);
    const hamming = 0.54 - 0.46 * Math.cos(2 * Math.PI * index / (FILTER_LENGTH - 1));
    taps[index] = (high - low) * hamming;
  }
  const centerHz = Math.sqrt(lowHz * highHz); let real = 0, imaginary = 0;
  for (let index = 0; index < taps.length; index += 1) {
    const angle = -2 * Math.PI * centerHz * index / sampleRateHz;
    real += taps[index] * Math.cos(angle); imaginary += taps[index] * Math.sin(angle);
  }
  const gain = Math.max(1e-12, Math.hypot(real, imaginary));
  for (let index = 0; index < taps.length; index += 1) taps[index] /= gain;
  filterCache.set(key, taps); return taps;
}

function filterValid(input: Float32Array, taps: Float64Array): Float64Array {
  const outputLength = input.length - taps.length + 1;
  if (outputLength < 32) throw new Error("signal window is too short for the CCA FIR filter");
  const output = new Float64Array(outputLength);
  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const inputEnd = outputIndex + taps.length - 1; let sum = 0;
    for (let tap = 0; tap < taps.length; tap += 1) sum += taps[tap] * input[inputEnd - tap];
    output[outputIndex] = sum;
  }
  return output;
}

/** Filter each acquired sample once; preserve state across packet boundaries.
 * The first 256 outputs after reset are settling samples, never classification data.
 * A fixed per-channel offset is subtracted in double precision before filtering.
 */
export class ContinuousFbccaFilterBank {
  private histories: Float64Array[][];
  private offsets: number[] | null = null;
  private cursor = 0;
  private taps: Float64Array[];
  readonly channelCount: number;
  constructor(sampleRateHz: number, channelCount: number) {
    this.channelCount = channelCount;
    this.taps = [6, 14].map(low => bandpassTaps(sampleRateHz, low, FILTER_HIGH_HZ));
    this.histories = this.taps.map(() => Array.from({ length: channelCount }, () => new Float64Array(FILTER_LENGTH)));
  }
  reset(): void {
    this.histories.forEach(bank => bank.forEach(history => history.fill(0)));
    this.offsets = null; this.cursor = 0;
  }
  process(channels: Float32Array[]): Float64Array[][] {
    if (channels.length !== this.channelCount || channels.some(channel => channel.length !== channels[0].length || channel.some(value => !Number.isFinite(value)))) throw new Error("invalid continuous FBCCA input");
    const count = channels[0].length;
    if (count && !this.offsets) this.offsets = channels.map(channel => channel[0]);
    const output = this.taps.map(() => channels.map(() => new Float64Array(count)));
    for (let sample = 0; sample < count; sample++) {
      for (let channel = 0; channel < this.channelCount; channel++) {
        const value = channels[channel][sample] - this.offsets![channel];
        for (let bank = 0; bank < this.taps.length; bank++) {
          const history = this.histories[bank][channel]; history[this.cursor] = value;
          let sum = 0, index = this.cursor;
          for (let tap = 0; tap < FILTER_LENGTH; tap++) {
            sum += this.taps[bank][tap] * history[index];
            if (--index < 0) index = FILTER_LENGTH - 1;
          }
          output[bank][channel][sample] = sum;
        }
      }
      this.cursor = (this.cursor + 1) % FILTER_LENGTH;
    }
    return output;
  }
}

function covariance(left: Float64Array[], right: Float64Array[]): Matrix {
  const sampleCount = left[0].length, output = left.map(() => right.map(() => 0));
  const leftMeans = left.map((variable) => variable.reduce((sum, value) => sum + value, 0) / sampleCount);
  const rightMeans = right.map((variable) => variable.reduce((sum, value) => sum + value, 0) / sampleCount);
  for (let first = 0; first < left.length; first += 1) {
    for (let second = 0; second < right.length; second += 1) {
      let sum = 0;
      for (let sample = 0; sample < sampleCount; sample += 1) {
        sum += (left[first][sample] - leftMeans[first]) * (right[second][sample] - rightMeans[second]);
      }
      output[first][second] = sum / Math.max(1, sampleCount - 1);
    }
  }
  return output;
}

function regularize(matrix: Matrix): Matrix {
  const output = matrix.map((row) => row.slice());
  const averageVariance = output.reduce((sum, row, index) => sum + Math.max(0, row[index]), 0) / output.length;
  const ridge = Math.max(1e-12, averageVariance * 1e-6);
  for (let index = 0; index < output.length; index += 1) output[index][index] += ridge;
  return output;
}

function cholesky(matrix: Matrix): Matrix {
  const size = matrix.length, lower = matrix.map(() => Array(size).fill(0));
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column <= row; column += 1) {
      let value = matrix[row][column];
      for (let inner = 0; inner < column; inner += 1) value -= lower[row][inner] * lower[column][inner];
      if (row === column) lower[row][column] = Math.sqrt(Math.max(value, 1e-15));
      else lower[row][column] = value / lower[column][column];
    }
  }
  return lower;
}

function solveLower(lower: Matrix, values: number[]): number[] {
  const result = Array(values.length).fill(0);
  for (let row = 0; row < values.length; row += 1) {
    let value = values[row];
    for (let column = 0; column < row; column += 1) value -= lower[row][column] * result[column];
    result[row] = value / lower[row][row];
  }
  return result;
}

function largestSymmetricEigenvalue(matrix: Matrix): number {
  const size = matrix.length; let vector = Array(size).fill(1 / Math.sqrt(size));
  for (let iteration = 0; iteration < 64; iteration += 1) {
    const next = matrix.map((row) => row.reduce((sum, value, index) => sum + value * vector[index], 0));
    const norm = Math.hypot(...next); if (norm < 1e-15) return 0;
    const normalized = next.map((value) => value / norm);
    const delta = Math.hypot(...normalized.map((value, index) => value - vector[index]));
    vector = normalized; if (delta < 1e-10) break;
  }
  const multiplied = matrix.map((row) => row.reduce((sum, value, index) => sum + value * vector[index], 0));
  return Math.max(0, vector.reduce((sum, value, index) => sum + value * multiplied[index], 0));
}

/** Largest canonical correlation between multichannel EEG and sine/cosine references. */
function canonicalCorrelation(eeg: Float64Array[], reference: Float64Array[]): number {
  const covarianceX = regularize(covariance(eeg, eeg));
  const covarianceY = regularize(covariance(reference, reference));
  const cross = covariance(eeg, reference);
  const lowerX = cholesky(covarianceX), lowerY = cholesky(covarianceY);
  const firstWhitening = cross.map(() => Array(reference.length).fill(0));
  for (let column = 0; column < reference.length; column += 1) {
    const solved = solveLower(lowerX, cross.map((row) => row[column]));
    for (let row = 0; row < eeg.length; row += 1) firstWhitening[row][column] = solved[row];
  }
  const whitened = firstWhitening.map((row) => solveLower(lowerY, row));
  const gram = whitened.map((row) => whitened.map((_, second) =>
    row.reduce((sum, value, column) => sum + value * whitened[second][column], 0)));
  return Math.min(1, Math.sqrt(largestSymmetricEigenvalue(gram)));
}

function makeReferences(sampleCount: number, sampleRateHz: number, frequencyHz: number, harmonics: number): Float64Array[] {
  const output: Float64Array[] = [];
  for (let harmonic = 1; harmonic <= harmonics; harmonic += 1) {
    const sine = new Float64Array(sampleCount), cosine = new Float64Array(sampleCount);
    const angular = 2 * Math.PI * frequencyHz * harmonic / sampleRateHz;
    for (let sample = 0; sample < sampleCount; sample += 1) {
      sine[sample] = Math.sin(angular * sample); cosine[sample] = Math.cos(angular * sample);
    }
    output.push(sine, cosine);
  }
  return output;
}

function rawFbccaScore(filteredBanks: Float64Array[][], sampleRateHz: number, frequencyHz: number, harmonics: number, onCorrelation?: (value: number) => void): number {
  let score = 0;
  filteredBanks.forEach((bank, bankIndex) => {
    const correlation = canonicalCorrelation(bank, makeReferences(bank[0].length, sampleRateHz, frequencyHz, harmonics));
    if (bankIndex === 0) onCorrelation?.(correlation);
    score += correlation * correlation / Math.pow(bankIndex + 1, 1.25);
  });
  return score;
}

function comparisonFrequencies(targetHz: number, targetsHz: number[]): number[] {
  const candidates = [-1, -0.5, 0.5, 1].map((offset) => targetHz + offset)
    .filter((frequency) => frequency > 1 && targetsHz.every((target) => target === targetHz || Math.abs(target - frequency) >= 0.2));
  if (candidates.length < 2) throw new Error("target frequencies are too close for local CCA score normalization");
  return candidates;
}

/**
 * True multichannel filter-bank CCA with local-frequency normalization.
 *
 * All targets use the same harmonic count. Harmonics above the 45 Hz EEG
 * passband are excluded globally, which removes 16.5 x 3 = 49.5 Hz and keeps
 * scores comparable across targets.
 */
export function scoreFilterBank(
  channels: Float32Array[], sampleRateHz: number, frequenciesHz: number[], requestedHarmonics: number, correlations?: number[],
): FrequencyScore[] {
  if (!channels.length || channels.some((channel) => channel.length !== channels[0].length)) throw new Error("CCA requires rectangular channel data");
  const maximumComparisonHz = Math.max(...frequenciesHz) + 1;
  const harmonics = Math.max(1, Math.min(requestedHarmonics, Math.floor(FILTER_HIGH_HZ / maximumComparisonHz)));
  const banks: Array<[number, number]> = harmonics >= 2 ? [[6, FILTER_HIGH_HZ], [14, FILTER_HIGH_HZ]] : [[6, FILTER_HIGH_HZ]];
  const filteredBanks = banks.map(([low, high]) => {
    const taps = bandpassTaps(sampleRateHz, low, high);
    return channels.map((channel) => filterValid(channel, taps));
  });
  return scoreFilteredBanks(filteredBanks, sampleRateHz, frequenciesHz, requestedHarmonics, correlations);
}

/** CCA receives the full requested window, already filtered by the acquisition stream. */
export function scoreFilteredBanks(
  banks: Array<ArrayLike<number>[]>, sampleRateHz: number, frequenciesHz: number[], requestedHarmonics: number, correlations?: number[],
): FrequencyScore[] {
  const harmonics = Math.max(1, Math.min(requestedHarmonics, Math.floor(FILTER_HIGH_HZ / (Math.max(...frequenciesHz) + 1))));
  const filteredBanks = banks.slice(0, harmonics >= 2 ? 2 : 1).map(bank => bank.map(channel => Float64Array.from(channel)));
  return frequenciesHz.map((frequencyHz, index) => {
    const targetScore = rawFbccaScore(filteredBanks, sampleRateHz, frequencyHz, harmonics, correlations ? value => { correlations[index] = value; } : undefined);
    const noiseScores = comparisonFrequencies(frequencyHz, frequenciesHz)
      .map((comparison) => rawFbccaScore(filteredBanks, sampleRateHz, comparison, harmonics));
    const localBaseline = noiseScores.reduce((sum, value) => sum + value, 0) / noiseScores.length;
    return { frequencyHz, score: targetScore / Math.max(localBaseline, 1e-12) };
  });
}

export function rankScores(scores: FrequencyScore[]) {
  const ranked = scores.map((item, index) => ({ ...item, index })).sort((a, b) => b.score - a.score);
  const total = ranked.reduce((sum, item) => sum + Math.max(0, item.score), 0) || 1;
  const best = ranked[0], second = ranked[1] ?? { score: 0 };
  return { candidateIndex: best.index, confidence: best.score / total,
    margin: (best.score - second.score) / Math.max(best.score, 1e-12), rawScores: scores.map((item) => item.score) };
}

export function assertSyntheticFrequencyDetection(): void {
  const sampleRateHz = 1000, sampleCount = 3500;
  const scenarios = [[12, 16.5], [10, 13, 16], [8, 11, 14, 17]];
  for (const frequencies of scenarios) for (const expected of frequencies.map((_, index) => index)) {
    const channels = [0, 0.4, 0.8, 1.2].map((phase) => {
      const signal = new Float32Array(sampleCount), frequencyHz = frequencies[expected];
      for (let sample = 0; sample < sampleCount; sample += 1) {
        signal[sample] = Math.sin(2 * Math.PI * frequencyHz * sample / sampleRateHz + phase)
          + 0.3 * Math.sin(2 * Math.PI * frequencyHz * 2 * sample / sampleRateHz + phase / 2)
          + 0.6 * Math.sin(2 * Math.PI * 50 * sample / sampleRateHz);
      }
      return signal;
    });
    const ranking = rankScores(scoreFilterBank(channels, sampleRateHz, frequencies, 3));
    if (ranking.candidateIndex !== expected || !Number.isFinite(ranking.confidence)) {
      throw new Error(`synthetic ${frequencies[expected]} Hz CCA self-test failed`);
    }
  }
}

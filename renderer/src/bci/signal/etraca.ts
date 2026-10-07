export interface CalibrationTrial {
  labelIndex: number;
  channels: Float32Array[];
}

export interface EtrcaModel {
  schemaVersion: 1;
  algorithm: "etraca-prototype";
  algorithmVersion: "0.1.0";
  sourceSampleRateHz: number;
  modelSampleRateHz: number;
  channelIndices: number[];
  sampleCount: number;
  trialsPerTarget: number[];
  filters: number[][];
  templates: number[][][];
  createdAt: string;
}

const mean = (values: Float32Array) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const downsampleAndCenter = (input: Float32Array, factor: number, sampleCount: number) => {
  const output = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) output[index] = input[index * factor];
  const average = mean(output); for (let index = 0; index < output.length; index += 1) output[index] -= average;
  return output;
};
const zeros = (size: number) => Array.from({ length: size }, () => Array<number>(size).fill(0));
const covarianceAdd = (target: number[][], left: Float32Array[], right: Float32Array[]) => {
  for (let row = 0; row < left.length; row += 1) for (let column = 0; column < right.length; column += 1) {
    let sum = 0; for (let sample = 0; sample < left[row].length; sample += 1) sum += left[row][sample] * right[column][sample];
    target[row][column] += sum;
  }
};
const solve = (matrix: number[][], right: number[]) => {
  const size = matrix.length, augmented = matrix.map((row, index) => [...row, right[index]]);
  for (let pivot = 0; pivot < size; pivot += 1) {
    let best = pivot; for (let row = pivot + 1; row < size; row += 1) if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[best][pivot])) best = row;
    [augmented[pivot], augmented[best]] = [augmented[best], augmented[pivot]];
    const divisor = augmented[pivot][pivot]; if (Math.abs(divisor) < 1e-12) throw new Error("eTRCA covariance matrix is singular");
    for (let column = pivot; column <= size; column += 1) augmented[pivot][column] /= divisor;
    for (let row = 0; row < size; row += 1) if (row !== pivot) {
      const scale = augmented[row][pivot]; for (let column = pivot; column <= size; column += 1) augmented[row][column] -= scale * augmented[pivot][column];
    }
  }
  return augmented.map((row) => row[size]);
};
const dominantGeneralizedEigenvector = (signal: number[][], covariance: number[][]) => {
  const size = signal.length, transformed = zeros(size);
  for (let column = 0; column < size; column += 1) {
    const solved = solve(covariance, signal.map((row) => row[column]));
    for (let row = 0; row < size; row += 1) transformed[row][column] = solved[row];
  }
  let vector = Array<number>(size).fill(1 / Math.sqrt(size));
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const next = transformed.map((row) => row.reduce((sum, value, index) => sum + value * vector[index], 0));
    const norm = Math.sqrt(next.reduce((sum, value) => sum + value * value, 0)) || 1;
    vector = next.map((value) => value / norm);
  }
  return vector;
};
const project = (channels: ArrayLike<ArrayLike<number>>, filter: number[]) => {
  const output = new Float32Array(channels[0].length);
  for (let channel = 0; channel < filter.length; channel += 1) for (let sample = 0; sample < output.length; sample += 1) output[sample] += channels[channel][sample] * filter[channel];
  return output;
};
const correlation = (left: number[], right: number[]) => {
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0, leftEnergy = 0, rightEnergy = 0;
  for (let index = 0; index < left.length; index += 1) { const a = left[index] - leftMean, b = right[index] - rightMean; numerator += a * b; leftEnergy += a * a; rightEnergy += b * b; }
  return numerator / Math.sqrt(Math.max(1e-12, leftEnergy * rightEnergy));
};

export function trainEtrca(trials: CalibrationTrial[], targetCount: number, sourceSampleRateHz: number, channelIndices: number[]): EtrcaModel {
  const grouped = Array.from({ length: targetCount }, (_, label) => trials.filter((trial) => trial.labelIndex === label));
  if (grouped.some((targetTrials) => targetTrials.length < 2)) throw new Error("eTRCA requires at least two calibration trials per target");
  const factor = Math.max(1, Math.round(sourceSampleRateHz / 250));
  const modelSampleRateHz = sourceSampleRateHz / factor;
  const sourceSamples = Math.min(...trials.map((trial) => trial.channels[0]?.length ?? 0));
  const sampleCount = Math.floor(sourceSamples / factor);
  if (sampleCount < modelSampleRateHz) throw new Error("calibration windows are too short for eTRCA");
  const prepared = grouped.map((targetTrials) => targetTrials.map((trial) => trial.channels.map((channel) => downsampleAndCenter(channel, factor, sampleCount))));
  const filters: number[][] = [], templates: number[][][] = [];
  for (const targetTrials of prepared) {
    const channelCount = targetTrials[0].length, signal = zeros(channelCount), covariance = zeros(channelCount);
    for (let first = 0; first < targetTrials.length; first += 1) {
      covarianceAdd(covariance, targetTrials[first], targetTrials[first]);
      for (let second = first + 1; second < targetTrials.length; second += 1) { covarianceAdd(signal, targetTrials[first], targetTrials[second]); covarianceAdd(signal, targetTrials[second], targetTrials[first]); }
    }
    const trace = covariance.reduce((sum, row, index) => sum + row[index], 0);
    for (let index = 0; index < channelCount; index += 1) covariance[index][index] += Math.max(1e-8, trace * 1e-6 / channelCount);
    filters.push(dominantGeneralizedEigenvector(signal, covariance));
    templates.push(Array.from({ length: channelCount }, (_, channel) => Array.from({ length: sampleCount }, (_, sample) => targetTrials.reduce((sum, trial) => sum + trial[channel][sample], 0) / targetTrials.length)));
  }
  return { schemaVersion: 1, algorithm: "etraca-prototype", algorithmVersion: "0.1.0", sourceSampleRateHz,
    modelSampleRateHz, channelIndices, sampleCount, trialsPerTarget: grouped.map((targetTrials) => targetTrials.length), filters, templates, createdAt: new Date().toISOString() };
}

export function scoreEtrca(channels: Float32Array[], model: EtrcaModel) {
  const factor = Math.max(1, Math.round(model.sourceSampleRateHz / model.modelSampleRateHz));
  const prepared = channels.map((channel) => downsampleAndCenter(channel, factor, Math.min(model.sampleCount, Math.floor(channel.length / factor))));
  const scores = model.templates.map((template) => {
    const testVector: number[] = [], templateVector: number[] = [];
    for (const filter of model.filters) { testVector.push(...project(prepared, filter)); templateVector.push(...project(template, filter).slice(0, prepared[0].length)); }
    return correlation(testVector, templateVector);
  });
  const ranked = scores.map((score, index) => ({ score, index })).sort((a, b) => b.score - a.score);
  const positive = ranked.map((item) => Math.max(0, (item.score + 1) / 2));
  const total = positive.reduce((sum, value) => sum + value, 0) || 1;
  return { candidateIndex: ranked[0].index, confidence: positive[0] / total,
    margin: (ranked[0].score - (ranked[1]?.score ?? -1)) / 2, rawScores: scores };
}

export function assertSyntheticEtrcaDetection(): void {
  const sampleRateHz = 1000, sampleCount = 2000, frequencies = [10, 12], trials: CalibrationTrial[] = [];
  for (let label = 0; label < frequencies.length; label += 1) for (let trial = 0; trial < 3; trial += 1) {
    trials.push({ labelIndex: label, channels: [0, .35, .7, 1.05].map((phase, channel) => Float32Array.from({ length: sampleCount }, (_, index) =>
      Math.sin(2 * Math.PI * frequencies[label] * index / sampleRateHz + phase) + .2 * Math.sin(4 * Math.PI * frequencies[label] * index / sampleRateHz + phase) + .01 * Math.sin(index * .17 + trial + channel))) });
  }
  const model = trainEtrca(trials, 2, sampleRateHz, [0, 1, 2, 3]);
  const result = scoreEtrca(trials[0].channels, model);
  if (result.candidateIndex !== 0 || !Number.isFinite(result.confidence)) throw new Error("synthetic eTRCA self-test failed");
}

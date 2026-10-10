import { ANALYSIS_LEADS, analysisChannelIndices, DEFAULT_DISPLAY_LEAD } from "./leads";
import { ReusableSpectrum } from "../../teaching/reusableSpectrum";
import { ObservationFilter, observationFilterInfo } from "../../teaching/observationFilter";
/// <reference lib="webworker" />
import { parseEegChunk, type EegChunk } from "../protocol";
import { assertSyntheticFrequencyDetection, scoreFilteredBanks, rankScores, ContinuousFbccaFilterBank, FBCCA_FILTER_WARMUP_SAMPLES } from "./fbcca";
import { assertSyntheticEtrcaDetection, scoreEtrca, trainEtrca, type CalibrationTrial, type EtrcaModel } from "./etraca";
import { preprocessChannels } from "./preprocess";
import { SignalRingBuffer } from "./ringBuffer";
import type { BciDecision, SignalConfig, WorkerInput, WorkerOutput, PsdDisplayChannel } from "./types";

let config: SignalConfig | null = null, buffer: SignalRingBuffer | null = null;
let sessionId: string | null = null, trialId: string | null = null, lastSequence: bigint | null = null;
let nextWindowEnd = 0, processedWindows = 0, invalidChunks = 0, sequenceDiscontinuities = 0, gapSinceWindow = false;
let votes: number[] = [];
let calibrationTrials: CalibrationTrial[] = [], etracaModel: EtrcaModel | null = null;
let markerSampleIndex: bigint | null = null, pendingChunks: EegChunk[] = [];
let syntheticChecksPassed = false;
const spectrumWorkspaces = Array.from({ length: 4 }, () => new ReusableSpectrum());
let meanSpectrumPower = new Float64Array();
// Separate display stream: never replace the raw/classifier ring buffer.
let psdBuffer: SignalRingBuffer | null = null;
let psdFilters: ObservationFilter[] = [];
let psdOrigin = 0;
let psdExpectedSample: bigint | null = null;
let psdSequence: bigint | null = null;
let lastGapEnd = -1;
let nextProgressSample = 0;
let cleanWindowStart = 0;
let expectedFirstSample: bigint | null = null;
let classifierFilter: ContinuousFbccaFilterBank | null = null;
let classifierBuffers: SignalRingBuffer[] = [];
let classifierOrigin = 0;
let classifierResetPending = false;
const send = (message: WorkerOutput) => self.postMessage(message);
// Each selected lead stays independent; preprocessing does not re-reference them.
const selectedChannels = analysisChannelIndices;

function resetPsdStream(): void {
  psdBuffer?.clear(); psdFilters.forEach(filter => filter.reset());
  psdOrigin = buffer?.totalSamplesWritten ?? 0;
  psdExpectedSample = psdSequence = null;
}

function resetClassifierStream(): void {
  classifierFilter?.reset(); classifierBuffers.forEach(bank => bank.clear());
  classifierOrigin = buffer?.totalSamplesWritten ?? 0;
  cleanWindowStart = Math.max(cleanWindowStart, classifierOrigin + FBCCA_FILTER_WARMUP_SAMPLES);
  if (config) nextWindowEnd = cleanWindowStart + Math.round(config.windowSeconds * config.sampleRateHz);
  classifierResetPending = false;
}

function pushClassifierSamples(chunk: EegChunk, offset: number, count: number): void {
  if (!config || !buffer || !classifierFilter) return;
  if (classifierResetPending) resetClassifierStream();
  const indices = selectedChannels(config.leadNames);
  const channels = indices.map(channel => Float32Array.from({ length: count }, (_, sample) => chunk.samples[(sample + offset) * chunk.channelCount + channel]));
  if (channels.some(channel => channel.some(value => !Number.isFinite(value)))) {
    classifierResetPending = true;
    // Keep sample positions aligned; subsequent clean data starts a new settling interval.
    classifierBuffers.forEach(bank => bank.pushTimeMajor(new Float32Array(count * indices.length), count));
    return;
  }
  classifierFilter.process(channels).forEach((bank, bankIndex) => {
    const interleaved = new Float32Array(count * indices.length);
    for (let sample = 0; sample < count; sample++) for (let channel = 0; channel < indices.length; channel++) interleaved[sample * indices.length + channel] = bank[channel][sample];
    classifierBuffers[bankIndex].pushTimeMajor(interleaved, count);
  });
}

function pushPsdSamples(chunk: EegChunk, offset: number, count: number): void {
  if (!config || !buffer || !psdBuffer) return;
  const first = chunk.firstSampleIndex + BigInt(offset);
  if ((psdExpectedSample !== null && first !== psdExpectedSample) ||
      (psdSequence !== null && chunk.gatewaySequence !== psdSequence + 1n) ||
      chunk.transportGapSuspected || psdBuffer.totalSamplesWritten !== buffer.totalSamplesWritten - psdOrigin) resetPsdStream();
  const indices = selectedChannels(config.leadNames);
  const channels = indices.map(channel => Float32Array.from({ length: count }, (_, sample) => chunk.samples[(sample + offset) * chunk.channelCount + channel]));
  if (channels.some(channel => channel.some(value => !Number.isFinite(value)))) { resetPsdStream(); return; }
  const filtered = channels.map((channel, index) => psdFilters[index].process(channel).bandpassed);
  const interleaved = new Float32Array(count * indices.length);
  for (let sample = 0; sample < count; sample++) for (let channel = 0; channel < indices.length; channel++) interleaved[sample * indices.length + channel] = filtered[channel][sample];
  psdBuffer.pushTimeMajor(interleaved, count);
  psdExpectedSample = first + BigInt(count); psdSequence = chunk.gatewaySequence;
}

function resetRuntime(): void {
  buffer?.clear(); sessionId = null; trialId = null; lastSequence = null; nextWindowEnd = 0;
  resetPsdStream();
  processedWindows = 0; invalidChunks = 0; sequenceDiscontinuities = 0; gapSinceWindow = false; votes = [];
  markerSampleIndex = null; pendingChunks = []; lastGapEnd = -1; nextProgressSample = 0; expectedFirstSample = null; cleanWindowStart = 0;
  resetClassifierStream();
}

function pushAlignedChunk(chunk: EegChunk): void {
  if (!config || !buffer || markerSampleIndex === null) return;
  const chunkEnd = chunk.firstSampleIndex + BigInt(chunk.sampleCountPerChannel);
  if (chunkEnd <= markerSampleIndex) return;
  const offset = markerSampleIndex > chunk.firstSampleIndex ? Number(markerSampleIndex - chunk.firstSampleIndex) : 0;
  const sampleCount = chunk.sampleCountPerChannel - offset;
  if (sampleCount <= 0) return;
  const trialFirst = Number(chunk.firstSampleIndex + BigInt(offset) - markerSampleIndex);
  if (trialFirst < buffer.totalSamplesWritten) { invalidChunks++; return; }
  if (trialFirst > buffer.totalSamplesWritten) {
    buffer.skipSamples(trialFirst - buffer.totalSamplesWritten);
    lastGapEnd = buffer.totalSamplesWritten; gapSinceWindow = true; classifierResetPending = true;
    resetPsdStream();
  }
  const samples = offset === 0 ? chunk.samples : chunk.samples.slice(offset * chunk.channelCount);
  pushPsdSamples(chunk, offset, sampleCount);
  pushClassifierSamples(chunk, offset, sampleCount);
  buffer.pushTimeMajor(samples, sampleCount); processAvailable();
  if (config.publishAnalysis && sessionId && trialId && buffer.totalSamplesWritten >= nextProgressSample) {
    const requiredSamples = Math.round(config.windowSeconds * config.sampleRateHz);
    send({ type: "analysis_progress", sessionId, trialId, samples: Math.max(0, Math.min(buffer.availableSamples, requiredSamples, buffer.totalSamplesWritten - cleanWindowStart)), requiredSamples, sampleRateHz: config.sampleRateHz });
    nextProgressSample = buffer.totalSamplesWritten + Math.round(config.sampleRateHz / 4);
  }
}

function processAvailable(): void {
  if (!config || !buffer || !sessionId || !trialId) return;
  const windowSamples = Math.round(config.windowSeconds * config.sampleRateHz);
  const hopSamples = Math.round(config.hopSeconds * config.sampleRateHz);
  if (nextWindowEnd === 0) nextWindowEnd = windowSamples + FBCCA_FILTER_WARMUP_SAMPLES;
  while (buffer.totalSamplesWritten >= nextWindowEnd && buffer.availableSamples >= windowSamples) {
    const end = nextWindowEnd, start = end - windowSamples;
    if (config.maxTrialSeconds !== undefined && end > Math.floor(config.maxTrialSeconds * config.sampleRateHz)) break;
    if (start < cleanWindowStart) { votes = []; nextWindowEnd += hopSamples; continue; }
    const rawChannels = buffer.windowEnding(end, windowSamples, selectedChannels(config.leadNames));
    const invalidWindow = classifierResetPending || rawChannels.some(channel => channel.some(value => !Number.isFinite(value)));
    const channelQuality = rawChannels.map((channel, index) => {
      let sum = 0, min = Infinity, max = -Infinity;
      for (const value of channel) { sum += value; min = Math.min(min, value); max = Math.max(max, value); }
      const mean = sum / channel.length;
      let variance = 0; for (const value of channel) variance += (value - mean) ** 2;
      return { lead: ANALYSIS_LEADS[index], meanUv: mean, rmsAcUv: Math.sqrt(variance / channel.length), peakToPeakUv: max - min };
    });
    const flatChannel = !invalidWindow && channelQuality.some(channel => channel.peakToPeakUv === 0);
    const transportGap = gapSinceWindow || start < lastGapEnd;
    const correlations: number[] = [];
    const channels = invalidWindow ? [] : preprocessChannels(rawChannels);
    const ranking = invalidWindow ? { candidateIndex: 0, confidence: 0, margin: 0, rawScores: config.targetFrequenciesHz.map(() => 0) } : etracaModel
      ? scoreEtrca(channels, etracaModel)
      : rankScores(scoreFilteredBanks(classifierBuffers.map(bank => bank.windowEnding(end - classifierOrigin, windowSamples, [0, 1, 2, 3])), config.sampleRateHz, config.targetFrequenciesHz, config.harmonics, correlations));
    const qualityReject = invalidWindow || flatChannel || transportGap || ranking.confidence < config.confidenceThreshold || ranking.margin < config.marginThreshold;
    votes.push(qualityReject ? -1 : ranking.candidateIndex); if (votes.length > config.requiredVotes) votes.shift();
    const stable = votes.length >= config.requiredVotes && votes.every((vote) => vote === ranking.candidateIndex);
    const rejected = qualityReject || !stable;
    const decision: BciDecision = { sessionId, trialId, candidateIndex: rejected ? null : ranking.candidateIndex,
      confidence: ranking.confidence, windowStartSample: start, windowEndSample: end,
      classifierName: etracaModel ? "etraca-prototype" : "fbcca-cca", classifierVersion: etracaModel ? "0.1.0" : "0.3.0", rejected,
      rankedCandidateIndex: ranking.candidateIndex, margin: ranking.margin, scores: ranking.rawScores,
      effectiveWindowSamples: windowSamples, filterWarmupSamples: FBCCA_FILTER_WARMUP_SAMPLES,
      confidenceThreshold: config.confidenceThreshold, marginThreshold: config.marginThreshold,
      channelQuality: invalidWindow ? undefined : channelQuality,
      reason: invalidWindow ? "invalid_samples" : flatChannel ? "flat_channel" : transportGap ? "transport_gap_suspected" : qualityReject ? "low_confidence" : !stable ? "unstable_vote" : undefined };
    if (config.publishMatches) decision.matches = invalidWindow || transportGap || etracaModel ? [] : config.targetFrequenciesHz.map((frequencyHz, index) => ({ frequencyHz, correlation: correlations[index], score: ranking.rawScores[index] }));
    if (config.publishAnalysis) {
      const fftLength = 2 ** Math.ceil(Math.log2(windowSamples));
      const channelSpectra: Record<PsdDisplayChannel, import("../../teaching/simulatedAnalysis").PowerSpectrum | null> = { P3: null, P4: null, Oz: null, Pz: null, mean: null };
      if (!invalidWindow && !transportGap && psdBuffer && start >= psdOrigin && psdBuffer.totalSamplesWritten >= end - psdOrigin) {
        const displayChannels = psdBuffer.windowEnding(end - psdOrigin, windowSamples, [0, 1, 2, 3]);
        const spectra = displayChannels.map((samples, index) => spectrumWorkspaces[index].compute(samples, config!.sampleRateHz, fftLength));
        const first = spectra[0];
        spectra.forEach((spectrum, index) => {
          channelSpectra[ANALYSIS_LEADS[index]] = spectrum && first ? { ...spectrum, frequenciesHz: first.frequenciesHz } : null;
        });
        if (first && spectra.every(spectrum => spectrum !== null && spectrum.invalidSamples === 0)) {
          if (meanSpectrumPower.length !== first.powerDensity.length) meanSpectrumPower = new Float64Array(first.powerDensity.length);
          for (let bin = 0; bin < meanSpectrumPower.length; bin++) {
            meanSpectrumPower[bin] = (spectra[0]!.powerDensity[bin] + spectra[1]!.powerDensity[bin] + spectra[2]!.powerDensity[bin] + spectra[3]!.powerDensity[bin]) / 4;
          }
          channelSpectra.mean = { ...first, powerDensity: meanSpectrumPower, mean: spectra.reduce((sum, spectrum) => sum + spectrum!.mean, 0) / 4 };
        }
      }
      const spectrum = channelSpectra[DEFAULT_DISPLAY_LEAD];
      send({ type: "analysis", analysis: { sessionId, trialId, sampleRateHz: config.sampleRateHz, windowStartSample: start, windowEndSample: end,
        psdBandpass: psdFilters[0] ? { lowHz: psdFilters[0].info.lowHz, highHz: psdFilters[0].info.highHz } : null,
        spectrum, channelSpectra, matches: invalidWindow || transportGap ? [] : config.targetFrequenciesHz.map((frequencyHz, index) => ({ frequencyHz, correlation: correlations[index] ?? 0, score: ranking.rawScores[index] })),
        candidateIndex: decision.candidateIndex, rejected, reason: decision.reason } });
    }
    send({ type: "decision", decision }); processedWindows += 1; gapSinceWindow = false; nextWindowEnd += hopSamples;
  }
}

self.onmessage = (event: MessageEvent<WorkerInput>) => {
  try {
    const message = event.data;
    if (message.type === "configure") {
      // Algorithms do not change between trials. Repeating these synthetic
      // checks on every teaching start competes with the first stimulus frames.
      if (!syntheticChecksPassed) {
        assertSyntheticFrequencyDetection(); assertSyntheticEtrcaDetection();
        syntheticChecksPassed = true;
      }
      selectedChannels(message.config.leadNames);
      config = message.config; buffer = new SignalRingBuffer(config.channelCount, config.sampleRateHz * 20);
      classifierFilter = new ContinuousFbccaFilterBank(config.sampleRateHz, ANALYSIS_LEADS.length);
      classifierBuffers = [0, 1].map(() => new SignalRingBuffer(ANALYSIS_LEADS.length, config!.sampleRateHz * 20));
      const displayFilter = config.publishAnalysis && observationFilterInfo(config.sampleRateHz);
      psdBuffer = displayFilter ? new SignalRingBuffer(4, config.sampleRateHz * 20) : null;
      psdFilters = displayFilter ? ANALYSIS_LEADS.map(() => new ObservationFilter(config!.sampleRateHz)) : [];
      calibrationTrials = []; etracaModel = null; resetRuntime(); send({ type: "ready" }); return;
    }
    if (message.type === "reset") { resetRuntime(); return; }
    if (message.type === "set_trial_marker") {
      // Gateway replies can arrive after cancellation or after a new trial has
      // started. Only the matching active trial may set its sample origin.
      if (message.sessionId !== sessionId || message.trialId !== trialId) return;
      markerSampleIndex = BigInt(message.firstSampleIndex);
      for (const chunk of pendingChunks) pushAlignedChunk(chunk);
      pendingChunks = []; return;
    }
    if (message.type === "invalidate_stimulus_window") {
      if (!config || !buffer || message.sessionId !== sessionId || message.trialId !== trialId) return;
      // Discard overlapping windows plus a conservative 0.5 s acquisition delivery allowance.
      cleanWindowStart = buffer.totalSamplesWritten + Math.ceil(config.sampleRateHz * .5);
      resetPsdStream();
      resetClassifierStream();
      votes = []; nextProgressSample = 0;
      send({ type: "stimulus_window_invalidated", sessionId: message.sessionId, trialId: message.trialId, revision: message.revision });
      return;
    }
    if (message.type === "clear_calibration") { calibrationTrials = []; etracaModel = null; send({ type: "calibration_progress", progress: { counts: config?.targetFrequenciesHz.map(() => 0) ?? [], requiredPerTarget: 2 } }); return; }
    if (message.type === "add_calibration_trial") {
      if (!config || !buffer) throw new Error("worker is not configured");
      if (message.labelIndex < 0 || message.labelIndex >= config.targetFrequenciesHz.length) throw new Error("calibration label is out of range");
      const requiredSamples = Math.round(config.sampleRateHz * 3.5);
      if (buffer.availableSamples < requiredSamples) throw new Error(`calibration trial has only ${buffer.availableSamples} samples; ${requiredSamples} required`);
      const sampleCount = Math.min(buffer.availableSamples, Math.round(config.sampleRateHz * 4));
      calibrationTrials.push({ labelIndex: message.labelIndex, channels: preprocessChannels(buffer.latest(sampleCount, selectedChannels(config.leadNames))) });
      const counts = config.targetFrequenciesHz.map((_, label) => calibrationTrials.filter((trial) => trial.labelIndex === label).length);
      send({ type: "calibration_progress", progress: { counts, requiredPerTarget: 2 } }); return;
    }
    if (message.type === "train_etraca") {
      if (!config) throw new Error("worker is not configured");
      const counts = config.targetFrequenciesHz.map((_, label) => calibrationTrials.filter((trial) => trial.labelIndex === label).length);
      if (counts.some((count) => count < message.requiredPerTarget)) throw new Error(`calibration incomplete: ${counts.join("/")}`);
      etracaModel = trainEtrca(calibrationTrials, config.targetFrequenciesHz.length, config.sampleRateHz, selectedChannels(config.leadNames));
      send({ type: "etraca_model", model: etracaModel }); return;
    }
    if (message.type === "stop_trial") { sessionId = null; trialId = null; votes = []; resetPsdStream(); return; }
    if (message.type === "start_trial") { if (!config || !buffer) throw new Error("worker is not configured"); resetRuntime(); sessionId = message.sessionId; trialId = message.trialId; return; }
    if (!config || !buffer) throw new Error("worker is not configured");
    const chunk = parseEegChunk(message.buffer);
    if (chunk.channelCount !== config.channelCount || chunk.sampleRateHz !== config.sampleRateHz) { invalidChunks += 1; throw new Error("真实 EEG 元数据不匹配，已停止分析"); }
    if (!sessionId || !trialId) return;
    if (chunk.sessionId !== sessionId) { invalidChunks += 1; return; }
    if (expectedFirstSample !== null && chunk.firstSampleIndex !== expectedFirstSample) { gapSinceWindow = true; classifierResetPending = true; lastGapEnd = buffer.totalSamplesWritten; }
    expectedFirstSample = chunk.firstSampleIndex + BigInt(chunk.sampleCountPerChannel);
    if (lastSequence !== null && chunk.gatewaySequence !== lastSequence + 1n) { sequenceDiscontinuities += 1; gapSinceWindow = true; classifierResetPending = true; lastGapEnd = buffer.totalSamplesWritten; }
    if (chunk.transportGapSuspected) { gapSinceWindow = true; classifierResetPending = true; lastGapEnd = buffer.totalSamplesWritten; }
    lastSequence = chunk.gatewaySequence;
    if (markerSampleIndex === null) pendingChunks.push(chunk); else pushAlignedChunk(chunk);
    send({ type: "stats", bufferedSamples: buffer.availableSamples, processedWindows, invalidChunks, sequenceDiscontinuities });
  } catch (error) { send({ type: "error", message: (error as Error).message }); }
};

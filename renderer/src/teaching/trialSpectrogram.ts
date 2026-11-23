import type { RealTrialAnalysis, PsdDisplayChannel } from "../bci/signal/types";
import type { RealEegSnapshot } from "./realEegAnalysis";

/** Display adapter only: use the exact PSD and sample interval already emitted by the Worker. */
export function trialSpectrogramFrame(analysis: RealTrialAnalysis | null, channel: PsdDisplayChannel) {
  const valid = analysis && Number.isFinite(analysis.sampleRateHz) && analysis.sampleRateHz > 0
    && Number.isSafeInteger(analysis.windowStartSample) && Number.isSafeInteger(analysis.windowEndSample)
    && analysis.windowStartSample >= 0 && analysis.windowEndSample > analysis.windowStartSample
    && analysis.reason !== "invalid_samples" && analysis.reason !== "transport_gap_suspected";
  const spectrum = valid ? analysis.channelSpectra[channel] : null;
  const windowSamples = valid ? analysis.windowEndSample - analysis.windowStartSample : 0;
  const snapshot: RealEegSnapshot = {
    state: spectrum ? "running" : "waiting", notice: null, historyNotice: null,
    sampleRateHz: valid ? analysis.sampleRateHz : null, windowSamples, fftLength: spectrum ? (spectrum.frequenciesHz.length - 1) * 2 : 0,
    sampleCount: windowSamples, samples: new Float32Array(),
    windowStartSample: valid ? BigInt(analysis.windowStartSample) : null,
    windowEndSampleExclusive: valid ? BigInt(analysis.windowEndSample) : null,
    lastDataAtMs: null, version: valid ? analysis.windowEndSample : 0,
  };
  return { spectrum, snapshot, key: JSON.stringify([analysis?.sessionId, analysis?.trialId, channel,
    analysis?.sampleRateHz, analysis?.psdBandpass ?? null]) };
}

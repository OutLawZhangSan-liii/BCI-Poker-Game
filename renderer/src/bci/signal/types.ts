import type { PowerSpectrum } from "../../teaching/simulatedAnalysis";

export interface SignalConfig {
  sampleRateHz: number;
  channelCount: number;
  leadNames: string[];
  targetFrequenciesHz: number[];
  windowSeconds: number;
  hopSeconds: number;
  harmonics: number;
  confidenceThreshold: number;
  marginThreshold: number;
  requiredVotes: number;
  publishAnalysis?: boolean;
  publishMatches?: boolean;
  maxTrialSeconds?: number;
}

export interface CandidateMatch { frequencyHz: number; correlation: number; score: number; }

export interface BciDecision {
  matches?: CandidateMatch[];
  sessionId: string;
  trialId: string;
  candidateIndex: number | null;
  confidence: number;
  windowStartSample: number;
  windowEndSample: number;
  classifierName: string;
  classifierVersion: string;
  rejected: boolean;
  reason?: string;
  rankedCandidateIndex?: number;
  margin?: number;
  scores?: number[];
  effectiveWindowSamples?: number;
  filterWarmupSamples?: number;
  confidenceThreshold?: number;
  marginThreshold?: number;
  channelQuality?: { lead: string; meanUv: number; rmsAcUv: number; peakToPeakUv: number }[];
}

export interface CalibrationProgress { counts: number[]; requiredPerTarget: number; }

export type PsdDisplayChannel = "O1" | "O2" | "P3" | "P4" | "mean";

export interface RealTrialAnalysis {
  sessionId: string; trialId: string; windowStartSample: number; windowEndSample: number;
  sampleRateHz: number; spectrum: PowerSpectrum | null;
  psdBandpass?: { lowHz: number; highHz: number } | null;
  channelSpectra: Record<PsdDisplayChannel, PowerSpectrum | null>;
  matches: { frequencyHz: number; correlation: number; score: number }[];
  candidateIndex: number | null; rejected: boolean; reason?: string;
}

export type WorkerInput =
  | { type: "configure"; config: SignalConfig }
  | { type: "start_trial"; sessionId: string; trialId: string }
  | { type: "set_trial_marker"; sessionId: string; trialId: string; firstSampleIndex: string }
  | { type: "add_calibration_trial"; labelIndex: number }
  | { type: "train_etraca"; requiredPerTarget: number }
  | { type: "clear_calibration" }
  | { type: "eeg"; buffer: ArrayBuffer }
  | { type: "invalidate_stimulus_window"; sessionId: string; trialId: string; revision: number }
  | { type: "stop_trial" }
  | { type: "reset" };

export type WorkerOutput =
  | { type: "analysis"; analysis: RealTrialAnalysis }
  | { type: "analysis_progress"; sessionId: string; trialId: string; samples: number; requiredSamples: number; sampleRateHz: number }
  | { type: "stimulus_window_invalidated"; sessionId: string; trialId: string; revision: number }
  | { type: "ready" }
  | { type: "stats"; bufferedSamples: number; processedWindows: number; invalidChunks: number; sequenceDiscontinuities: number }
  | { type: "decision"; decision: BciDecision }
  | { type: "calibration_progress"; progress: CalibrationProgress }
  | { type: "etraca_model"; model: import("./etraca").EtrcaModel }
  | { type: "error"; message: string };

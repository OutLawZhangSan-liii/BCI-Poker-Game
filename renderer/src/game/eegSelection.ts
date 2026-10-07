import type { BciDecision } from "../bci/signal/types";

export const GAME_STIMULUS_MS = 6000;
export const GAME_ANALYSIS_GRACE_MS = 500;

export interface GameEegTrial {
  sessionId: string;
  trialId: string;
  frequencies: number[];
  onsetMs: number;
  sampleRateHz: number;
}

/** Presentation/selection boundary only; classification stays in the shared Worker. */
export function gameDecisionChoice(decision: BciDecision, trial: GameEegTrial, nowMs: number): number | null {
  if (decision.sessionId !== trial.sessionId || decision.trialId !== trial.trialId || decision.classifierName !== "fbcca-cca"
    || decision.rejected || decision.candidateIndex === null || !Number.isInteger(decision.candidateIndex)
    || decision.candidateIndex < 0 || decision.candidateIndex >= trial.frequencies.length
    || nowMs < trial.onsetMs || nowMs > trial.onsetMs + GAME_STIMULUS_MS + GAME_ANALYSIS_GRACE_MS
    || decision.windowStartSample < 0 || decision.windowEndSample <= decision.windowStartSample
    || decision.windowEndSample > Math.floor(trial.sampleRateHz * GAME_STIMULUS_MS / 1000)) return null;
  return decision.candidateIndex;
}

export function gameEegReadiness(connected: boolean, streaming: boolean, leads: string[]): string | null {
  if (!connected) return "请先连接 EEG 设备";
  if (!streaming) return "请先开始 EEG 采集";
  const normalized = leads.map(lead => lead.trim().toUpperCase());
  if (["O1", "O2", "P3", "P4"].some(lead => !normalized.includes(lead))) return "EEG 尚未就绪：需要 O1 / O2 / P3 / P4";
  return null;
}

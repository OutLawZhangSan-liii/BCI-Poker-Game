import { fbccaDecisionPolicy, FBCCA_POLICY_VERSION } from "./decisionPolicy";
import { ANALYSIS_LEADS } from "./leads";
export type GameClassifierProfile = "butterworth-trial-v1" | "fir-baseline-v1";
export const DEFAULT_GAME_CLASSIFIER: GameClassifierProfile = "butterworth-trial-v1";
export function parseGameClassifier(value: unknown): GameClassifierProfile {
  if (value === "butterworth-trial-v1" || value === "fir-baseline-v1") return value;
  throw new Error("识别方案不受当前版本支持");
}
export function gameClassifierPolicy(profile: GameClassifierProfile, count: number) {
  return profile === "butterworth-trial-v1" ? {confidenceThreshold:.25,marginThreshold:.08,requiredVotes:2,validated:false} : fbccaDecisionPolicy(count);
}
export function gameClassifierIdentity(profile: GameClassifierProfile) {
  return profile === "butterworth-trial-v1" ? {name:"fbcca-butterworth",version:"trial-1.0.0"} : {name:"fbcca-cca",version:"0.3.0"};
}
/** Preserve the exact legacy fingerprint when resuming a saved challenge. */
export function gameClassifierConfiguration(profile: GameClassifierProfile, sampleRateHz: number, simulation: boolean, stimulusMs: number, graceMs: number, windowSeconds: number) {
  const base = { ...gameClassifierIdentity(profile), policy: FBCCA_POLICY_VERSION, leads: ANALYSIS_LEADS,
    source: simulation ? "isolated-simulation" : "real-eeg", sampleRateHz, windowSeconds, filter:"continuous-fir",warmup:256,
    hopSeconds:.25,harmonics:3,filterBandsHz:[[6,45],[14,45]],filterLength:257,
    policies:[2,4,6].map(fbccaDecisionPolicy),stimulusMs,graceMs };
  if (profile === "fir-baseline-v1") return JSON.stringify(base);
  return JSON.stringify({...base,profile,policy:"butterworth-raw-share025-margin008-v1",filter:"continuous-butterworth-sos",filterLength:undefined,
    highpassOrder:4,lowpassOrder:4,ccaSolver:"jacobi",relativeRidge:1e-8,normalization:"raw",weights:[1,2**-1.25],policies:[2,4,6].map(n=>gameClassifierPolicy(profile,n))});
}
export function savedGameClassifier(classifier: string): GameClassifierProfile {
  const config=JSON.parse(classifier);
  if (config.profile !== undefined) return parseGameClassifier(config.profile);
  if (config.name === "fbcca-cca" && config.version === "0.3.0") return "fir-baseline-v1";
  throw new Error("此挑战的识别方案不受当前版本支持");
}

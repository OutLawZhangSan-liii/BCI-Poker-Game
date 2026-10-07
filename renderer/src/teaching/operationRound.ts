import type { CandidateMatch } from "../bci/signal/types";
export type StimulusMode = "NONE" | "LEFT_ONLY" | "RIGHT_ONLY" | "BOTH";
export interface OperationTrial { stimulusMode: Exclude<StimulusMode, "NONE">; target: 0 | 1; }
export const OPERATION_TRIALS: readonly OperationTrial[] = [
  { stimulusMode: "LEFT_ONLY", target: 0 }, { stimulusMode: "RIGHT_ONLY", target: 1 },
  { stimulusMode: "BOTH", target: 0 }, { stimulusMode: "BOTH", target: 1 },
];
export const TRAINING_TIMING = { cueSeconds: 3, stimulusMs: 6000, feedbackMs: 1200, interTrialMs: 600 };
export type TrialOutcome = "correct" | "incorrect" | "rejected" | "paused" | "interrupted";
export type RoundPhase = "READY" | "TARGET_CUE" | "STIMULATING" | "FEEDBACK" | "INTER_TRIAL" | "ROUND_COMPLETE";
export interface OperationTrialResult { index: number; stimulusMode: OperationTrial["stimulusMode"]; targetLabel: string; targetFrequencyHz: number; predictedLabel: string | null; predictedFrequencyHz: number | null; outcome: "correct" | "incorrect" | "rejected"; matches: CandidateMatch[]; reason?: string; }
export interface RoundState { results: OperationTrialResult[]; active: boolean; paused: boolean; index: number; phase: RoundPhase; completed: number; correct: number; incorrect: number; rejected: number; }
export const EMPTY_ROUND: RoundState = { results: [], active: false, paused: false, index: 0, phase: "READY", completed: 0, correct: 0, incorrect: 0, rejected: 0 };

// Orchestration only: real EEG classification remains in the existing trial runner.
export class OperationRound {
  state = { ...EMPTY_ROUND };
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private remaining = 0;
  private startedAt = 0;
  private delayed: (() => void) | null = null;
  private gates: Array<() => void> = [];
  private callbacks: {
    runTrial: (trial: OperationTrial, index: number) => Promise<TrialOutcome>;
    interruptTrial: () => void;
    change: (state: RoundState) => void;
    error: (error: unknown) => void;
  };
  constructor(callbacks: OperationRound["callbacks"]) { this.callbacks = callbacks; }
  recordResult(result: OperationTrialResult) {
    if (!this.state.active || this.state.phase !== "STIMULATING" || result.index !== this.state.index) return;
    this.state.results = [...this.state.results.filter(item => item.index !== result.index), { ...result, matches: result.matches.map(match => ({ ...match })) }].slice(-4);
  }
  private publish() { this.callbacks.change({ ...this.state }); }
  setPhase(phase: RoundPhase) { if (this.state.active) { this.state.phase = phase; this.publish(); } }
  async gate() { if (this.state.paused && this.state.active) await new Promise<void>(resolve => this.gates.push(resolve)); }
  delay(ms: number) {
    this.remaining = ms;
    return new Promise<void>(resolve => { this.delayed = resolve; if (!this.state.paused) this.schedule(); });
  }
  private schedule() {
    this.startedAt = performance.now();
    this.timer = setTimeout(() => { this.timer = null; const done = this.delayed; this.delayed = null; done?.(); }, this.remaining);
  }
  pause() {
    if (!this.state.active || this.state.paused) return;
    this.state.paused = true;
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; this.remaining = Math.max(0, this.remaining - (performance.now() - this.startedAt)); }
    if (this.state.phase === "STIMULATING") this.callbacks.interruptTrial();
    this.publish();
  }
  resume() {
    if (!this.state.active || !this.state.paused) return;
    this.state.paused = false; this.publish();
    if (this.delayed) this.schedule();
    this.gates.splice(0).forEach(resolve => resolve());
  }
  stop() {
    this.generation++;
    this.state.active = false; this.state.paused = false; this.state.phase = "READY";
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null; const done = this.delayed; this.delayed = null; done?.();
    this.gates.splice(0).forEach(resolve => resolve());
    this.callbacks.interruptTrial(); this.publish();
  }
  reset() { if (!this.state.active) { this.state = { ...EMPTY_ROUND }; this.publish(); } }
  async start() {
    if (this.state.active) return;
    const generation = ++this.generation;
    this.state = { ...EMPTY_ROUND, active: true }; this.publish();
    try {
      for (let index = 0; index < OPERATION_TRIALS.length; index++) {
        this.state.index = index;
        let outcome: TrialOutcome;
        do {
          await this.gate(); if (generation !== this.generation) return;
          this.setPhase("TARGET_CUE");
          outcome = await this.callbacks.runTrial(OPERATION_TRIALS[index], index);
          if (generation !== this.generation) return;
        } while (outcome === "paused");
        if (outcome === "interrupted") { this.stop(); return; }
        this.state.completed++; this.state[outcome]++; this.setPhase("FEEDBACK");
        await this.delay(TRAINING_TIMING.feedbackMs); await this.gate(); if (generation !== this.generation) return;
        if (index < OPERATION_TRIALS.length - 1) {
          this.setPhase("INTER_TRIAL"); await this.delay(TRAINING_TIMING.interTrialMs); await this.gate();
          if (generation !== this.generation) return;
        }
      }
      this.state.active = false; this.state.phase = "ROUND_COMPLETE"; this.publish();
    } catch (error) { if (generation === this.generation) { this.stop(); this.callbacks.error(error); } }
  }
}

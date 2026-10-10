import { gameStimulusTemplateForMode } from "../game/stimulusTemplate";
import type { StimulusAppearance } from "../bci/stimulus/comparison";
import type { StimulusFrameStats } from "../bci/stimulus/types";

export const LAB_PROTOCOL = "multi-target-form-algorithm-v1";
export const MAIN_BASELINE = "e1ceefd6a0d52ad5d00b7e1f68c5155db6f31025";
export const LAB_TIMING = { cue: 2000, stimulus: 10000, rest: 6000, break: 60000, baseline: 20000 } as const;
export const FORMS = ["solid", "card", "card-face"] as const;
export const FORM_LABELS: Record<StimulusAppearance, string> = { solid: "灰度刺激块", card: "扑克牌外围闪烁", "card-face": "扑克牌整体闪烁" };
export type TargetCount = 2 | 4 | 6;
export interface LabItem { id: string; batch: number; group: number; count: TargetCount; appearance: StimulusAppearance; cue: number; kind: "active" | "static"; split: "development" | "test" | "reference"; }
export interface LabAttempt { trialId: string; itemId: string; sessionId: string; startedAt: string; status: "started" | "complete" | "invalid"; reason?: string; attention: "pending" | "confirmed" | "excluded"; comfort?: number; stats?: StimulusFrameStats; }
export interface LabRun { schemaVersion: 1; protocol: typeof LAB_PROTOCOL; baselineCommit: string; id: string; revision: number; seed: number; createdAt: string; items: LabItem[]; attempts: LabAttempt[]; sessions: string[]; breakUntil: number; geometrySignatures?: Partial<Record<TargetCount, string>>; }
export function labTemplate(count: TargetCount) { return gameStimulusTemplateForMode(count === 2 ? "simple" : count === 4 ? "difficult1" : "difficult2"); }
export function labTargets(count: TargetCount) { return labTemplate(count).targets; }
export function labCueLabel(item: LabItem) {
  const position = item.count===2 ? ["左侧","右侧"] : item.count===4 ? ["左上","右上","左下","右下"] : ["左上","中上","右上","左下","中下","右下"];
  return `${position[item.cue]} ${item.cue+1} 号 · ${labTargets(item.count)[item.cue].frequencyHz} Hz`;
}
export function seededRandom(seed: number) { let state = seed >>> 0; return () => { state += 0x6d2b79f5; let t = Math.imul(state ^ state >>> 15, 1 | state); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function createLabRun(id: string, seed: number, createdAt = new Date().toISOString()): LabRun {
  const random = seededRandom(seed), items: LabItem[] = [];
  const orders: TargetCount[][] = [[2,4,6],[4,6,2],[6,2,4],[2,6,4],[6,4,2],[4,2,6]];
  const shuffle = <T,>(rows: T[]) => { for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [rows[i], rows[j]] = [rows[j], rows[i]]; } return rows; };
  for (let group = 1; group <= 6; group++) for (const [part, count] of orders[group - 1].entries()) {
    const batch = (group - 1) * 3 + part;
    if (group === 1) for (const appearance of shuffle([...FORMS])) items.push({ id: `static-${count}-${appearance}`, batch, group: 0, count, appearance, cue: 0, kind: "static", split: "reference" });
    const active = FORMS.flatMap(appearance => Array.from({ length: count }, (_, cue): LabItem => ({ id: `g${group}-${count}-${appearance}-${cue}`, batch, group, count, appearance, cue, kind: "active", split: group <= 4 ? "development" : "test" })));
    items.push(...shuffle(active));
  }
  return { schemaVersion: 1, protocol: LAB_PROTOCOL, baselineCommit: MAIN_BASELINE, id, revision: 0, seed, createdAt, items, attempts: [], sessions: [], breakUntil: 0 };
}
export function completedItemIds(run: LabRun) { return new Set(run.attempts.filter(a => a.status === "complete" && a.attention !== "excluded").map(a => a.itemId)); }
export function pendingItems(run: LabRun) { const done = completedItemIds(run); return run.items.filter(item => !done.has(item.id)); }
export function recoverLabRun(run: LabRun): LabRun { return { ...run, attempts: run.attempts.map(a => a.status === "started" ? { ...a, status: "invalid", reason: "application_interrupted" } : a) }; }

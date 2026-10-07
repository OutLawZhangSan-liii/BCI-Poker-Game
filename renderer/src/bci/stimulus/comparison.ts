export type StimulusAppearance = "card" | "card-face" | "solid";
export type FixationMode = "fixed" | "synchronous";
export type EvocationCondition = "static" | "12hz" | "15hz";
export interface StimulusComparisonCondition {
  condition: EvocationCondition;
  frequencyHz: number;
  repetition: number;
  appearance?: StimulusAppearance;
  segment?: 1 | 2;
  fixationMode?: FixationMode;
}
export const STIMULUS_COMPARISON_PROTOCOL = "central-appearance-comparison-v1";
export const CARD_FACE_COMPARISON_PROTOCOL = "central-cardface-comparison-v1";
export const THREE_FORM_COMPARISON_PROTOCOL = "central-three-form-comparison-v1";
export const SHORT_FIXATION_PROTOCOL = "central-short-fixation-comparison-v1";
export const SHORT_TRIAL_COUNT = 30;
export const SHORT_HALFWAY_COUNT = 18;
export const SHORT_BASELINE_MS = 20_000;
export const SHORT_REST_MS = 6_000;
export const SHORT_BREAK_MS = 60_000;
export const COMPARISON_BASELINE_MS = 30_000;
export const COMPARISON_CUE_MS = 2_000;
export const COMPARISON_REST_MS = 10_000;
export const COMPARISON_STIMULUS_MS = 10_000;
export const COMPARISON_REPETITIONS = 8;
export const COMPARISON_BLOCK_SIZE = 6;
export const COMPARISON_TRIAL_COUNT = COMPARISON_REPETITIONS * COMPARISON_BLOCK_SIZE;
export const COMPARISON_HALFWAY_COUNT = COMPARISON_TRIAL_COUNT / 2;
export const THREE_FORM_BLOCK_SIZE = 9;
export const THREE_FORM_TRIAL_COUNT = COMPARISON_REPETITIONS * THREE_FORM_BLOCK_SIZE;
export const THREE_FORM_HALFWAY_COUNT = THREE_FORM_TRIAL_COUNT / 2;
export const COMPARISON_BREAK_MS = 90_000;
export const COMPARISON_ANALYSIS_WINDOWS = { full: [1.5, 9.5], early: [1.5, 5.5], late: [5.5, 9.5] } as const;

// Each randomized block contains all three conditions. Save actual order in markers.
export function createEvocationSequence(random: () => number = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32): StimulusComparisonCondition[] {
  const result: StimulusComparisonCondition[] = [];
  for (let repetition = 1; repetition <= 5; repetition++) {
    const block: StimulusComparisonCondition[] = [
      { condition: "static", frequencyHz: 0, repetition },
      { condition: "12hz", frequencyHz: 12, repetition },
      { condition: "15hz", frequencyHz: 15, repetition },
    ];
    for (let i = block.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.max(0, Math.floor(random() * (i + 1))));
      [block[i], block[j]] = [block[j], block[i]];
    }
    result.push(...block);
  }
  return result;
}

// Same central target, card identity and phase; each block matches both forms
// to their own static control. Retain the old generator for historical replay.
export function createAppearanceSequence(random: () => number = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32, cardAppearance: "card" | "card-face" = "card"): StimulusComparisonCondition[] {
  return createFormSequence([cardAppearance, "solid"], random);
}

export function createThreeFormSequence(random: () => number = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32): StimulusComparisonCondition[] {
  return createFormSequence(["card", "card-face", "solid"], random);
}

function createFormSequence(appearances: StimulusAppearance[], random: () => number): StimulusComparisonCondition[] {
  const result: StimulusComparisonCondition[] = [];
  for (let repetition = 1; repetition <= COMPARISON_REPETITIONS; repetition++) {
    const block: StimulusComparisonCondition[] = [];
    for (const appearance of appearances) {
      for (const [condition, frequencyHz] of [["static", 0], ["12hz", 12], ["15hz", 15]] as const) {
        block.push({ condition, frequencyHz, repetition, appearance, segment: repetition <= 4 ? 1 : 2 });
      }
    }
    for (let i = block.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.max(0, Math.floor(random() * (i + 1))));
      [block[i], block[j]] = [block[j], block[i]];
    }
    result.push(...block);
  }
  return result;
}

// Six one-off matched static references, followed by two complete randomized
// twelve-condition blocks. Shared references do not add independent repeats.
export function createShortFixationSequence(random: () => number = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32): StimulusComparisonCondition[] {
  const shuffle = (block: StimulusComparisonCondition[]) => {
    for (let i = block.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.max(0, Math.floor(random() * (i + 1))));
      [block[i], block[j]] = [block[j], block[i]];
    }
    return block;
  };
  const variants = (["card", "card-face", "solid"] as const).flatMap(appearance =>
    (["fixed", "synchronous"] as const).map(fixationMode => ({ appearance, fixationMode })));
  const result = shuffle(variants.map(variant => ({ ...variant, condition: "static", frequencyHz: 0, repetition: 0, segment: 1 })));
  for (const repetition of [1, 2]) {
    result.push(...shuffle(variants.flatMap(variant => ([12, 15] as const).map(frequencyHz => ({
      ...variant, condition: frequencyHz === 12 ? "12hz" : "15hz", frequencyHz, repetition, segment: repetition as 1 | 2,
    })))));
  }
  return result;
}

export function diagnosticDataFresh(ageMs: number | null, packetDurationMs: number | null, policy: "legacy" | "short" = "legacy"): boolean {
  return ageMs !== null && Number.isFinite(ageMs) && ageMs >= 0
    && packetDurationMs !== null && Number.isFinite(packetDurationMs) && packetDurationMs > 0
    && ageMs <= (policy === "short" ? Math.max(500, packetDurationMs * 3) : Math.max(100, packetDurationMs * 1.5));
}

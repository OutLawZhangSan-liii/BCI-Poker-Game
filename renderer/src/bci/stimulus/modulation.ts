/** Contrast-depth experiment used only by the game's Difficulty 2 preview. */
export type GameModulationIntensity = "standard" | "reduced" | "soft";

export const GAME_MODULATION_DEPTH: Record<GameModulationIntensity, number> = {
  standard: 1,
  reduced: 0.6,
  soft: 0.4,
};

export const STIMULUS_MEAN_LEVEL = 131;

/** Standard depth is kept on the exact legacy rounding path. */
export function modulationLevel(luminance: number, depth = 1): number {
  const baseline = 42 + luminance * 178;
  if (depth === 1) return Math.round(baseline);
  return Math.round(STIMULUS_MEAN_LEVEL + (baseline - STIMULUS_MEAN_LEVEL) * depth);
}

export function theoreticalModulationRange(depth: number): { minimum: number; maximum: number; mean: number } {
  return {
    minimum: STIMULUS_MEAN_LEVEL + (42 - STIMULUS_MEAN_LEVEL) * depth,
    maximum: STIMULUS_MEAN_LEVEL + (220 - STIMULUS_MEAN_LEVEL) * depth,
    mean: STIMULUS_MEAN_LEVEL,
  };
}

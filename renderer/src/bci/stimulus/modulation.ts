/** Contrast-depth experiment used only by the game's Difficulty 2 preview. */
export type GameModulationIntensity = "standard" | "reduced" | "soft";

export const GAME_MODULATION_DEPTH: Record<GameModulationIntensity, number> = {
  standard: 1,
  reduced: 0.6,
  soft: 0.4,
};

export const STIMULUS_MEAN_LEVEL = 131;

export const CARD_FACE_BRIGHTNESS_VERSION = "black-overlay-linear-rgb-v2";
export const CARD_FACE_BRIGHTNESS_RANGE = { minimum: 0.05, maximum: 1 } as const;

/** Display RGB multiplier, not calibrated optical luminance. The default
 * .5 + .45*sin phase remains unchanged; only its affine contrast mapping differs.
 * Reduced depth still reduces contrast around the same mean. */
export function cardFaceBrightness(luminance: number, depth = 1): number {
  const { minimum, maximum } = CARD_FACE_BRIGHTNESS_RANGE;
  const mean = (minimum + maximum) / 2;
  return Math.min(1, Math.max(0, mean + (luminance - 0.5) / 0.45 * (maximum - minimum) / 2 * depth));
}

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

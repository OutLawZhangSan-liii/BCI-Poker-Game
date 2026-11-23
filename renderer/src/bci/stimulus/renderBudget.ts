// Spatial raster resolution only: never RAF cadence, CSS geometry or luminance.
// Preserve the old budget for saved challenges and high refresh-rate displays.
export const MAX_STIMULUS_RENDER_SCALE = 1;
export const MAX_STIMULUS_BACKING_PIXELS = 1_050_000;
export const MAX_SHARP_RENDER_SCALE = 2;
export const MAX_SHARP_BACKING_PIXELS = 4_200_000;
export type RasterQuality = "balanced-v1" | "sharp-v1";
export const CURRENT_RASTER_QUALITY: RasterQuality = "sharp-v1";

export function stimulusRenderScale(width: number, height: number, displayScale: number, quality: RasterQuality = "balanced-v1", refreshRateHz = 60): number {
  const area = Math.max(1, width) * Math.max(1, height);
  const scale = Number.isFinite(displayScale) && displayScale > 0 ? displayScale : 1;
  const sharp = quality === "sharp-v1" && refreshRateHz <= 90;
  const maximumScale = sharp ? MAX_SHARP_RENDER_SCALE : MAX_STIMULUS_RENDER_SCALE;
  const pixelBudget = sharp ? MAX_SHARP_BACKING_PIXELS : MAX_STIMULUS_BACKING_PIXELS;
  // Match geometry's minimum raster scale so unusually large canvases remain
  // legible. The pixel budget is a target rather than an 8K allocation limit.
  return Math.max(.5, Math.min(scale, maximumScale, Math.sqrt(pixelBudget / area)));
}

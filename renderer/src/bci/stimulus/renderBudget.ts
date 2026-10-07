// Bound texture allocation independently of the monitor's display scale.
// This affects spatial raster resolution only, never RAF cadence or luminance.
// A 240 Hz display leaves about 4 ms for rendering and presentation. Keep
// one raster pixel per CSS pixel rather than multiplying that work by DPR².
// Surrounding HTML text still renders at the native display resolution.
export const MAX_STIMULUS_RENDER_SCALE = 1;
export const MAX_STIMULUS_BACKING_PIXELS = 1_050_000;

export function stimulusRenderScale(width: number, height: number, displayScale: number): number {
  const area = Math.max(1, width) * Math.max(1, height);
  const scale = Number.isFinite(displayScale) && displayScale > 0 ? displayScale : 1;
  // Match geometry's minimum raster scale so unusually large canvases remain
  // legible. The pixel budget is a target rather than an 8K allocation limit.
  return Math.max(.5, Math.min(scale, MAX_STIMULUS_RENDER_SCALE, Math.sqrt(MAX_STIMULUS_BACKING_PIXELS / area)));
}

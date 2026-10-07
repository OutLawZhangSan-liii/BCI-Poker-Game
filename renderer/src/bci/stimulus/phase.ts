/** Keep visual phase tied to elapsed time, even when a display frame is missed. */
export const STIMULUS_TIMING_VERSION = "elapsed-time-v1";

export function stimulusLuminanceAt(
  timestampMs: number,
  firstFrameMs: number,
  frequencyHz: number,
  phaseRad: number,
  baseline: number,
  amplitude: number,
): number {
  const elapsedSeconds = Math.max(0, timestampMs - firstFrameMs) / 1_000;
  return baseline + amplitude * Math.sin(2 * Math.PI * frequencyHz * elapsedSeconds + phaseRad);
}

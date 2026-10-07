export interface StimulusTarget {
  id: string;
  frequencyHz: number;
  phaseRad: number;
  label: string;
  x: number;
  y: number;
}

export interface StimulusFrameStats {
  firstFramePerformanceMs: number;
  lastFramePerformanceMs: number;
  renderedFrames: number;
  suspectedDroppedFrames: number;
  measuredRefreshRateHz: number;
  expectedRefreshRateHz?: number;
  maxFrameIntervalMs?: number;
  maxDrawDurationMs?: number;
}

/**
 * Historical normalized geometry for the validated two-target stimulus.
 * Runtime drawing now resolves responsive dimensions from the stimulus
 * container; these values remain the protocol baseline used by marker data.
 */
export const SIMPLE_STIMULUS_GEOMETRY = {
  version: "simple-geometry-v2",
  canvasHeightPx: 600,
  cardWidthPx: 136,
  cardHeightPx: 190,
  ringPx: 44,
  referenceX: 0.5,
  referenceY: 0.24,
  leftX: 0.24,
  rightX: 0.76,
  targetY: 0.64,
} as const;

/** Versioned frequency pair; changing either target invalidates prior models. */
export const SIMPLE_STIMULUS_FREQUENCY = {
  version: "simple-frequency-v6",
  leftHz: 12,
  rightHz: 15,
} as const;

/**
 * Two-target calibration/online preset.
 *
 * v6 follow-up mapping: 12 Hz remains on the left and 15 Hz is on the right
 * to test whether the previous 16.5 Hz response was subject-dependent. Both
 * remain below the 45 Hz analysis ceiling for the first two harmonics. Do not
 * combine v4/v5/v6 records in one model.
 */
export const SIMPLE_TARGETS: StimulusTarget[] = [
  { id: "target_left", frequencyHz: SIMPLE_STIMULUS_FREQUENCY.leftHz, phaseRad: 0, label: "7♣", x: SIMPLE_STIMULUS_GEOMETRY.leftX, y: SIMPLE_STIMULUS_GEOMETRY.targetY },
  { id: "target_right", frequencyHz: SIMPLE_STIMULUS_FREQUENCY.rightHz, phaseRad: Math.PI / 2, label: "Q♥", x: SIMPLE_STIMULUS_GEOMETRY.rightX, y: SIMPLE_STIMULUS_GEOMETRY.targetY },
];

/** Four-target layout reserved for the validated difficult-1 mode. */
export const DIFFICULT1_TARGETS: StimulusTarget[] = [
  { id: "target_top_left", frequencyHz: 7.5, phaseRad: 0, label: "4♠", x: 0.25, y: 0.3 },
  { id: "target_top_right", frequencyHz: 8.57, phaseRad: Math.PI / 2, label: "7♥", x: 0.75, y: 0.3 },
  { id: "target_bottom_left", frequencyHz: 10, phaseRad: Math.PI, label: "10♣", x: 0.25, y: 0.74 },
  { id: "target_bottom_right", frequencyHz: 12, phaseRad: Math.PI * 1.5, label: "Q♦", x: 0.75, y: 0.74 },
];

/** Six-target demo/formal layout: three columns by two rows. */
export const DIFFICULT2_DEMO_TARGETS: StimulusTarget[] = [
  { id: "target_top_left", frequencyHz: 7.5, phaseRad: 0, label: "3♠", x: 0.38, y: 0.32 },
  { id: "target_top_center", frequencyHz: 8.57, phaseRad: Math.PI / 3, label: "5♥", x: 0.59, y: 0.32 },
  { id: "target_top_right", frequencyHz: 10, phaseRad: Math.PI * 2 / 3, label: "8♣", x: 0.80, y: 0.32 },
  { id: "target_bottom_left", frequencyHz: 12, phaseRad: Math.PI, label: "J♦", x: 0.38, y: 0.70 },
  { id: "target_bottom_center", frequencyHz: 13.33, phaseRad: Math.PI * 4 / 3, label: "Q♠", x: 0.59, y: 0.70 },
  { id: "target_bottom_right", frequencyHz: 14, phaseRad: Math.PI * 5 / 3, label: "K♥", x: 0.80, y: 0.70 },
];

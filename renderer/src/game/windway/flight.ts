export type Direction = -1 | 0 | 1;
export type Difficulty = "easy" | "hard";
export const windStrength = { easy: 0, hard: 1.5 } as const;
export type WindowMode = "fixed" | "dynamic";
export const targetHz = [12, 15] as const;
// World coordinates shared by the flight model and the painted wing tips.
export const corridorHalfWidth = 600;
export const wingHalfSpan = 100;
const wingTipY = 56;
export const bankScale = (roll: number) => 1 - .14 * Math.abs(Math.sin(roll));
export const gateInterval = 4.5;
export const gateTime = (index: number) => 4.3 + index * gateInterval;
// The opening is measured between the inner faces of the two posts at the crossing plane.
export const gateFrameWidth = 12;
export const gateHalfOpening = 175;
const gateOffsets = [-165, 185, -28, -205, 150, 0, -190, 198, 32, 182] as const;
export const gateOffset = (index: number) => gateOffsets[index % gateOffsets.length];
export const centerHalfWidth = wingHalfSpan / 2;

function crossing(index: number, leftTip: number, rightTip: number) {
  const offset = gateOffset(index);
  const left = offset - gateHalfOpening, right = offset + gateHalfOpening;
  if (leftTip > left && rightTip < right) return "passed";
  if (rightTip < left - gateFrameWidth || leftTip > right + gateFrameWidth) return "missed";
  return "hit";
}

export function wind(time: number, difficulty: Difficulty) {
  if (windStrength[difficulty] === 0) return 0;
  const turn = Math.floor(time / gateInterval);
  const phase = (time % gateInterval - 0.35) / 2.9;
  const gust = phase > 0 && phase < 1 ? Math.sin(Math.PI * phase) * (turn % 2 ? -1 : 1) : 0;
  return (gust * (110 + 13 * Math.sin(turn)) + 8 * Math.sin(0.85 * time)) * windStrength[difficulty];
}
export function newFlight(difficulty: Difficulty = "easy") {
  return { difficulty, time: 0, x: 0, velocity: 0, force: 0, bank: 0, passed: 0, attempts: 0, centerSeconds: 0,
    lastHitGate: -1,
    tail: new Float32Array(121), tailIndex: 0, maxFrameMs: 0 };
}
export type Flight = ReturnType<typeof newFlight>;
export function stepFlight(f: Flight, dt: number, direction: Direction, limit: number) {
  const remaining = limit ? gateTime(limit - 1) - f.time : dt;
  const step = Math.min(dt, Math.max(0, remaining));
  f.force += (direction - f.force) * (1 - Math.exp(-step / 0.18));
  const gust = wind(f.time, f.difficulty);
  f.velocity += (gust + 212 * f.force - 1.22 * f.velocity) * step;
  f.x += f.velocity * step;
  const tilt = Math.max(-25, Math.min(25, f.force * 17 + f.velocity * 0.065 + gust * 0.059));
  f.bank += (tilt - f.bank) * (1 - Math.exp(-step / 0.22));
  f.time += step;
  const roll = f.bank * Math.PI / 180;
  const tipCenter = f.x - wingTipY * Math.sin(roll);
  const halfWidth = wingHalfSpan * bankScale(roll) * Math.cos(roll);
  const tipLimit = corridorHalfWidth - halfWidth;
  if (Math.abs(tipCenter) >= tipLimit) {
    const side = tipCenter < 0 ? -1 : 1;
    f.x += side * tipLimit - tipCenter;
    if (side * f.velocity > 0) f.velocity = 0;
  }
  if (Math.abs(f.x) <= centerHalfWidth) f.centerSeconds += step;
  if ((!limit || f.attempts < limit) && f.time + 1e-8 >= gateTime(f.attempts)) {
    const center = f.x - wingTipY * Math.sin(roll);
    const outcome = crossing(f.attempts, center - halfWidth, center + halfWidth);
    if (outcome === "passed") f.passed++;
    if (outcome === "hit") f.lastHitGate = f.attempts;
    f.attempts++;
  }
  f.tailIndex = (f.tailIndex + 1) % f.tail.length;
  f.tail[f.tailIndex] = f.x;
  return limit > 0 && f.attempts >= limit;
}
export function newMarkers() {
  return { gaze: null as Direction | null, lastSide: 0 as Direction, pendingAt: null as number | null,
    centerMarks: 0, centerPushes: 0, switches: 0, matched: 0, latencySum: 0, lastCommand: 0 as Direction };
}
export type Markers = ReturnType<typeof newMarkers>;
export function markGaze(m: Markers, gaze: Direction, time: number) {
  if (gaze === m.gaze) return;
  m.gaze = gaze; m.pendingAt = null;
  if (gaze === 0) {
    m.centerMarks++;
    if (m.lastCommand) m.centerPushes++;
  } else {
    if (m.lastSide && gaze !== m.lastSide) { m.switches++; m.pendingAt = time; }
    m.lastSide = gaze;
    if (m.pendingAt !== null && m.lastCommand === gaze) { m.matched++; m.pendingAt = null; }
  }
}
export function observeCommand(m: Markers, command: Direction, time: number) {
  if (m.gaze === 0 && command && command !== m.lastCommand) m.centerPushes++;
  if (m.pendingAt !== null && command === m.gaze) {
    m.latencySum += Math.max(0, time - m.pendingAt); m.matched++; m.pendingAt = null;
  }
  m.lastCommand = command;
}
export function clearMarkerContext(m: Markers) {
  m.gaze = null; m.pendingAt = null; m.lastSide = 0; m.lastCommand = 0;
}

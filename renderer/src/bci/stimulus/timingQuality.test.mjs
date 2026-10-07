import assert from 'node:assert/strict';
import test from 'node:test';
import { StimulusTimingQuality } from './timingQuality.ts';

test('isolated dropped frames continue and do not accumulate phase delay', () => {
  const monitor = new StimulusTimingQuality(); let time = 0;
  for (let i = 0; i < 120; i++) { time += 1000 / 60; assert.equal(monitor.sample(time, 1000 / 60, 60).severe, false); }
  time += 50; const glitch = monitor.sample(time, 50, 60);
  assert.equal(glitch.dropped, true); assert.equal(glitch.lostFrames, 2); assert.equal(glitch.severe, false); assert.equal(glitch.invalidate, false);
  for (let i = 0; i < 180; i++) { time += 1000 / 60; const q = monitor.sample(time, 1000 / 60, 60); assert.equal(q.severe, false); }
  assert.equal(monitor.sample(time + 17, 17, 60).warning, false);
});
test('persistent frame loss stops only after sustained observation; long stalls stop immediately', () => {
  const monitor = new StimulusTimingQuality(); let time = 0, warning = false, stoppedAt = 0;
  for (let i = 0; i < 100; i++) { time += 1000 / 30; const q = monitor.sample(time, 1000 / 30, 60); warning ||= q.warning; if (q.severe) { stoppedAt = time; break; } }
  assert.equal(warning, true); assert.ok(stoppedAt >= 2000 && stoppedAt < 2500);
  monitor.reset(); assert.equal(monitor.sample(250, 250, 60).severe, true);
  monitor.reset(); assert.equal(monitor.sample(17, 17, 60).severe, false);
});

test('only a burst or a noticeable stall invalidates analysis; isolated light drops age out', () => {
  const monitor = new StimulusTimingQuality();
  assert.equal(monitor.sample(50, 50, 60).invalidate, false);
  assert.equal(monitor.sample(650, 50, 60).invalidate, false);
  assert.equal(monitor.sample(683, 33, 60).invalidate, true);
  monitor.reset(); assert.equal(monitor.sample(100, 100, 60).invalidate, true);
  monitor.reset();
  assert.equal(monitor.sample(33, 33, 60).invalidate, false);
  assert.equal(monitor.sample(66, 33, 60).invalidate, false);
  assert.equal(monitor.sample(99, 33, 60).invalidate, true);
});

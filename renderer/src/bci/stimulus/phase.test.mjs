import assert from "node:assert/strict";
import test from "node:test";
import { stimulusLuminanceAt } from "./phase.ts";

test("the first frame uses the configured starting phase", () => {
  assert.ok(Math.abs(stimulusLuminanceAt(500, 500, 15, Math.PI / 2, 0.5, 0.3) - 0.8) < 1e-12);
});

test("a skipped display callback does not leave a persistent phase offset", () => {
  const firstFrameMs = 1_000;
  const afterGapMs = firstFrameMs + 100;
  const actual = stimulusLuminanceAt(afterGapMs, firstFrameMs, 12, 0, 0.5, 0.3);
  const expected = 0.5 + 0.3 * Math.sin(2 * Math.PI * 12 * 0.1);
  assert.ok(Math.abs(actual - expected) < 1e-12);
  assert.ok(Math.abs(actual - stimulusLuminanceAt(firstFrameMs + 2 * 1_000 / 145, firstFrameMs, 12, 0, 0.5, 0.3)) > 0.01);
});

test("both game frequencies catch up to one logical monotonic onset across repeated missed frames", () => {
  for (const onset of [1000, 5000, 9000]) {
    for (const elapsed of [50, 66.67, 100, 116.67, 700, 733.34, 1200, 1300]) {
      for (const [hz, phase] of [[12, 0], [15, Math.PI / 2]]) {
        assert.ok(Math.abs(stimulusLuminanceAt(onset + elapsed, onset, hz, phase, .5, .45) - (.5 + .45 * Math.sin(2 * Math.PI * hz * elapsed / 1000 + phase))) < 1e-11);
      }
    }
  }
  assert.notEqual(stimulusLuminanceAt(1050, 1000, 15, Math.PI / 2, .5, .45), stimulusLuminanceAt(1050, 1050, 15, Math.PI / 2, .5, .45));
});

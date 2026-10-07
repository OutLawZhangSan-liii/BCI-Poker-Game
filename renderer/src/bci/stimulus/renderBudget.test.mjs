import assert from "node:assert/strict";
import test from "node:test";
import { stimulusRenderScale, MAX_STIMULUS_BACKING_PIXELS } from "./renderBudget.ts";

test("200% display scaling bounds the stimulus texture while retaining CSS geometry", () => {
  const width = 1260, height = 650;
  const scale = stimulusRenderScale(width, height, 2);
  assert.equal(scale, 1);
  assert.ok(width * height * scale * scale <= MAX_STIMULUS_BACKING_PIXELS + .001);
  assert.ok(width * height * scale * scale < width * height * 4 * .5);
});

test("normal display scale is retained and larger canvases fit the pixel budget", () => {
  assert.equal(stimulusRenderScale(960, 640, 1), 1);
  const scale = stimulusRenderScale(2560, 1600, 2);
  assert.ok(2560 * 1600 * scale * scale <= MAX_STIMULUS_BACKING_PIXELS + .001);
  assert.equal(stimulusRenderScale(640, 400, NaN), 1);
});

import assert from "node:assert/strict";
import test from "node:test";
import { stimulusRenderScale, MAX_STIMULUS_BACKING_PIXELS, MAX_SHARP_BACKING_PIXELS } from "./renderBudget.ts";
import { computeResponsiveStimulusGeometry } from "./geometry.ts";

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

test("sharp rendering uses native high-DPI pixels without exceeding the bounded allocation", () => {
  assert.equal(stimulusRenderScale(1260, 650, 2, "sharp-v1"), 2);
  assert.equal(stimulusRenderScale(1260, 650, 1.5, "sharp-v1"), 1.5);
  assert.equal(stimulusRenderScale(1920, 1080, 1, "sharp-v1"), 1);
  for (const [width, height] of [[1920, 1080], [2560, 1600]]) {
    const scale = stimulusRenderScale(width, height, 3, "sharp-v1");
    assert.ok(scale > stimulusRenderScale(width, height, 3));
    assert.ok(width * height * scale * scale <= MAX_SHARP_BACKING_PIXELS + .001);
  }
});

test("high-refresh displays retain the conservative budget and raster density does not move targets", () => {
  for (const hz of [120, 144, 240]) assert.equal(stimulusRenderScale(1260, 650, 2, "sharp-v1", hz), stimulusRenderScale(1260, 650, 2));
  const input = { width: 1260, height: 650, targets: [{ x: .24, y: .64 }, { x: .76, y: .64 }], showReference: true };
  const previous = computeResponsiveStimulusGeometry({ ...input, devicePixelRatio: 1 });
  const sharp = computeResponsiveStimulusGeometry({ ...input, devicePixelRatio: 2 });
  assert.deepEqual(sharp.targets, previous.targets);
  assert.deepEqual(sharp.reference, previous.reference);
  assert.equal(sharp.backingWidth, previous.backingWidth * 2);
});

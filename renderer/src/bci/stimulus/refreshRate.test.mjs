import assert from "node:assert/strict";
import test from "node:test";
import { measureDisplayRefreshRate } from "./refreshRate.ts";

function displayHarness() {
  const saved = Object.fromEntries(["window", "document", "requestAnimationFrame", "cancelAnimationFrame"].map(key => [key, globalThis[key]]));
  const frames = new Map(), timers = new Map();
  let id = 0;
  globalThis.document = new EventTarget(); document.hidden = false;
  globalThis.window = { setTimeout: callback => { timers.set(++id, callback); return id; }, clearTimeout: key => timers.delete(key) };
  globalThis.requestAnimationFrame = callback => { frames.set(++id, callback); return id; };
  globalThis.cancelAnimationFrame = key => frames.delete(key);
  return {
    frames, timers,
    frame(timestamp) { const [key, callback] = frames.entries().next().value; frames.delete(key); callback(timestamp); },
    restore() { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } },
  };
}

test("refresh measurement uses the median and releases its scheduled work", async () => {
  const display = displayHarness();
  try {
    const rate = measureDisplayRefreshRate(4);
    for (const timestamp of [100, 116.6667, 150, 166.6667, 183.3334]) display.frame(timestamp);
    assert.equal(await rate, 60);
    assert.equal(display.frames.size, 0); assert.equal(display.timers.size, 0);
  } finally { display.restore(); }
});

test("hiding the display cancels refresh measurement instead of hanging preparation", async () => {
  const display = displayHarness();
  try {
    const rate = measureDisplayRefreshRate();
    document.hidden = true; document.dispatchEvent(new Event("visibilitychange"));
    await assert.rejects(rate, /窗口已隐藏/);
    assert.equal(display.frames.size, 0); assert.equal(display.timers.size, 0);
  } finally { display.restore(); }
});

test("stalled frame callbacks time out and leave no animation callback", async () => {
  const display = displayHarness();
  try {
    const rate = measureDisplayRefreshRate();
    [...display.timers.values()][0]();
    await assert.rejects(rate, /测量超时/);
    assert.equal(display.frames.size, 0); assert.equal(display.timers.size, 0);
  } finally { display.restore(); }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { cardFaceBrightness, modulationLevel } from './modulation.ts';
import { stimulusLuminanceAt } from './phase.ts';

test('card face spans original pixels to five percent without changing sine phase', () => {
  for (const frequency of [7.5, 8.57, 10, 12, 13.33, 14, 15]) {
    for (const phase of [0, Math.PI / 2]) {
      for (const elapsed of [0, 16.667, 33.334, 100, 527, 1000]) {
        const input = stimulusLuminanceAt(2000 + elapsed, 2000, frequency, phase, .5, .45);
        const expected = .525 + .475 * Math.sin(2 * Math.PI * frequency * elapsed / 1000 + phase);
        assert.ok(Math.abs(cardFaceBrightness(input) - expected) < 1e-10);
      }
    }
  }
  assert.ok(Math.abs(cardFaceBrightness(.05) - .05) < 1e-12);
  assert.equal(cardFaceBrightness(.95), 1);
  assert.equal(cardFaceBrightness(.5, 0), .525);
});

test('gray-block and surround mapping retain their legacy values', () => {
  assert.equal(modulationLevel(.05), 51);
  assert.equal(modulationLevel(.5), 131);
  assert.equal(modulationLevel(.95), 211);
  for (const x of [.05,.5,.95]) assert.ok(cardFaceBrightness(x,.4) >= .335 && cardFaceBrightness(x,.4) <= .715000000001);
});

import test from "node:test";
import assert from "node:assert/strict";
import { modalBackdrop, titleBarAppearance, presentationPalette } from "./presentation.ts";
import { validateWindowAppearance } from "../../../desktop/main/windowAppearance.ts";

test("native caption and DOM backdrop use identical compositing for every supported theme", () => {
  for (const theme of ["crayon-paper-v1", "warm-paper-v1", "legacy-green-v1"]) {
    const palette = presentationPalette(theme), { rgb, alpha, css } = modalBackdrop(theme);
    const dimmed = titleBarAppearance(theme, true);
    assert.equal(css, `rgba(${rgb.join(",")},${alpha})`);
    [1, 3, 5].forEach((offset, i) => assert.equal(parseInt(dimmed.color.slice(offset, offset + 2), 16),
      Math.round(parseInt(palette.background.slice(offset, offset + 2), 16) * (1 - alpha) + rgb[i] * alpha)));
    assert.deepEqual(titleBarAppearance(theme, false), { color: palette.background, symbolColor: palette.ink });
  }
  assert.equal(titleBarAppearance("crayon-paper-v1", true).color, "#D6DBE6");
});
test("native window appearance accepts only six-digit colors and strips other window options", () => {
  for (const value of [null, true, {}, { color: "red", symbolColor: "#17356B" }, { color: "#FAFBFE", symbolColor: "transparent" }, { color: 123, symbolColor: "#17356B" }])
    assert.throws(() => validateWindowAppearance(value));
  assert.deepEqual(validateWindowAppearance({ color: "#FAFBFE", symbolColor: "#17356B", height: 999 }), { color: "#FAFBFE", symbolColor: "#17356B" });
});

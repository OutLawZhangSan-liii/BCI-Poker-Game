import test from "node:test";
import assert from "node:assert/strict";
import { generateGameRound, scoreChoice } from "./engine.ts";
import { GAME_PRESENTATION } from "./presentation.ts";

test("visible mode rules agree with actual candidate counts and winning cards", () => {
  for (const mode of Object.keys(GAME_PRESENTATION)) {
    for (let seed = 1; seed <= 50; seed++) {
      let state = seed;
      const round = generateGameRound(mode, () => {
        state = state * 16807 % 2147483647;
        return (state - 1) / 2147483646;
      });
      assert.equal(round.candidates.length, GAME_PRESENTATION[mode].count);
      const eligible = round.candidates.filter(card => card.rank > round.reference.rank);
      assert.ok(eligible.length > 0);
      assert.equal(round.candidates[round.correctIndex].rank, Math.min(...eligible.map(card => card.rank)));
    }
  }
});

test("difficulty recommendations are optional and scoring has a common scale", () => {
  assert.equal(GAME_PRESENTATION.simple.next, "difficult1");
  assert.equal(GAME_PRESENTATION.difficult1.next, "difficult2");
  assert.equal(GAME_PRESENTATION.difficult2.next, null);
  const baseline = scoreChoice("simple", 100, 1, 0, 0, 2200);
  for (const mode of ["difficult1", "difficult2"]) {
    assert.deepEqual(scoreChoice(mode, 100, 1, 0, 0, 2200), baseline);
    assert.equal(scoreChoice(mode, 100, 1, null, 0, 4000).gained, 0);
  }
});

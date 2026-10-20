import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CHALLENGE_RULE_VERSION, CHALLENGE_MODES, createChallenge, finishAttempt, challengeMetrics, rankChallenges, recoverChallenge, validateChallenge, isRoundComplete } from "../../../desktop/main/challengeModel.ts";
import { ChallengeStore } from "../../../dist-desktop/main/challengeStore.js";
import { ChallengeSession } from "./challengeSession.ts";
import { generateGameRound, scoreChoice } from "./engine.ts";

const config = { ruleVersion: CHALLENGE_RULE_VERSION, classifier: "test-classifier", stimulus: "test-stimulus" };
const empty = () => createChallenge(randomUUID(), "001234", "模拟同学", config);
function pending(record, ordinal, outcome = "correct", elapsed = 2000) {
  const next = structuredClone(record), mode = CHALLENGE_MODES[Math.floor(ordinal / 10)];
  let round = next.rounds[ordinal];
  if (!round) { round = { ...generateGameRound(mode, () => .4), mode, index: ordinal % 10, attempts: [] }; next.rounds.push(round); }
  const id = randomUUID();
  round.attempts.push({ id, trialId: randomUUID(), sessionId: "isolated-simulation", preparedAt: new Date().toISOString(), outcome: "pending",
    selectedIndex: null, logicalStartMs: null, firstFrameMs: null, endedMs: null, elapsedMs: null, reason: null });
  next.status = "running";
  const result = { outcome, selectedIndex: outcome === "correct" ? round.correctIndex : outcome === "incorrect" ? (round.correctIndex + 1) % round.candidates.length : null,
    logicalStartMs: 990, firstFrameMs: 1000, endedMs: 1000 + elapsed, reason: null };
  return { next, id, result };
}
function full(outcomes = Array(30).fill("correct"), elapsed = 2000) {
  let r = empty();
  outcomes.forEach((outcome, i) => { const p = pending(r, i, outcome, elapsed); r = finishAttempt(p.next, p.id, p.result); });
  return r;
}

test("identity keeps leading zeros and validates required fields", () => {
  assert.equal(empty().studentId, "001234");
  assert.throws(() => createChallenge(randomUUID(), "  ", "同学", config));
  assert.throws(() => createChallenge(randomUUID(), "123", "", config));
});
test("thirty rounds include refusals without retries, and streak resets at mode boundaries", () => {
  const r = full(Array.from({ length: 30 }, (_, i) => i === 4 ? "rejected" : i === 15 ? "incorrect" : "correct"), 2200);
  const m = challengeMetrics(r);
  assert.equal(r.status, "completed"); assert.equal(m.completed, 30);
  assert.equal(m.correct, 28); assert.equal(m.incorrect, 1); assert.equal(m.rejected, 1);
  assert.equal(m.firstAccuracy, 28 / 30); assert.equal(m.finalAccuracy, 28 / 30);
  assert.equal(m.meanMs, 2200); assert.equal(m.correctMeanMs, 2200); assert.equal(m.longestStreak, 10);
  for (const mode of CHALLENGE_MODES) assert.equal(challengeMetrics(r, mode).completed, 10);
  assert.equal(challengeMetrics(full()).longestStreak, 10);
  assert.deepEqual(scoreChoice("simple", 400, 4, null, 0, 6500), { total: 400, streak: 0, gained: 0, correct: false });
});
test("timeout and analysis wait are not clipped; only interrupted attempts can be repeated", () => {
  let p = pending(empty(), 0, "rejected", 6512);
  let r = finishAttempt(p.next, p.id, p.result);
  assert.ok(isRoundComplete(r.rounds[0])); assert.equal(challengeMetrics(r).meanMs, 6512);
  assert.deepEqual(finishAttempt(r, p.id, p.result), r);
  assert.throws(() => validateChallenge(pending(r, 0).next), /已结束/);
  p = pending(empty(), 0);
  r = recoverChallenge(p.next, "设备断流");
  assert.equal(challengeMetrics(r).completed, 0); assert.equal(r.rounds[0].attempts[0].outcome, "invalid");
  const retried = pending(r, 0, "correct", 3210);
  r = finishAttempt(retried.next, retried.id, retried.result);
  assert.equal(challengeMetrics(r).firstAccuracy, 1); assert.equal(challengeMetrics(r).meanMs, 3210);
  assert.equal(r.rounds[0].attempts.length, 2);
});
test("rankings use full precision, include repeated people, tie ranks, exclude partial and other configurations", () => {
  const a = full(), b = full(), slow = full(undefined, 2000.0001), weak = full(Array(30).fill("incorrect")), partial = empty();
  const foreign = full(); foreign.configuration = { ...config, classifier: "future-version" };
  const rows = rankChallenges([weak, a, slow, b, partial, foreign], "overall", config);
  assert.equal(rows.length, 4); assert.deepEqual(rows.map(r => r.rank), [1, 1, 3, 4]);
  assert.equal(rows[2].record.id, slow.id);
  const twenty = full(Array.from({ length: 30 }, (_, i) => i < 20 ? "correct" : "rejected"));
  const twentyOne = full(Array.from({ length: 30 }, (_, i) => i < 21 ? "correct" : "rejected"));
  assert.deepEqual(rankChallenges([twenty, twentyOne], "speed", config).map(r => r.record.id), [twentyOne.id]);
  for (const strategy of ["accuracy", "speed", "streak"]) assert.equal(rankChallenges([a, b], strategy, config).length, 2);
});

async function storeFixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "brain-game-challenge-"));
  assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, store: new ChallengeStore(directory) };
}
test("store preserves confirmed data, handles duplicate responses, and isolates corruption", async t => {
  const { directory, store } = await storeFixture(t);
  let r = await store.create(empty());
  assert.deepEqual(await store.create(r), r);
  const p = pending(r, 0);
  r = await store.save(p.next);
  assert.equal(r.revision, 1);
  assert.deepEqual(await store.save(p.next), r);
  const finished = finishAttempt(r, p.id, p.result);
  r = await store.save(finished);
  const restarted = new ChallengeStore(directory);
  assert.equal(challengeMetrics(await restarted.get(r.id)).completed, 1);
  const changed = structuredClone(r); changed.rounds[0].attempts[0].elapsedMs++;
  await assert.rejects(() => store.save(changed));
  const deleted = structuredClone(r); deleted.rounds = [];
  await assert.rejects(() => store.save(deleted), /删除/);
  await assert.rejects(() => store.save({ ...r, revision: 0 }), /版本/);
  await assert.rejects(() => store.get("../outside"), /编号/);
  const corrupt = randomUUID(); await writeFile(path.join(directory, `${corrupt}.json`), "{broken");
  const list = await store.list(); assert.equal(list.records.length, 1); assert.equal(list.warnings.length, 1);
  assert.equal(await readFile(path.join(directory, `${corrupt}.json`), "utf8"), "{broken");
});
test("failed disk writes preserve the previous atomic snapshot", async t => {
  const { directory, store } = await storeFixture(t);
  const record = await store.create(empty()), p = pending(record, 0);
  const obstacle = path.join(directory, `${record.id}.json.tmp`); await mkdir(obstacle);
  await assert.rejects(() => store.save(p.next));
  assert.deepEqual(await store.get(record.id), record);
  await rm(obstacle, { recursive: true });
  assert.equal((await store.save(p.next)).revision, 1);
});
test("failed result blocks later progression and retry commits exactly once", async t => {
  const { store } = await storeFixture(t); let fail = false, fault = null;
  const session = new ChallengeSession(async r => { if (fail) throw new Error("disk unavailable"); return store.save(r); }, () => {}, message => { fault = message; }, recoverChallenge);
  session.load(await store.create(empty()));
  const p = pending(session.record, 0);
  await session.mutate(() => p.next);
  fail = true;
  await assert.rejects(() => session.mutate(r => finishAttempt(r, p.id, p.result)));
  assert.match(fault, /保存失败/); assert.equal(challengeMetrics(session.record).completed, 0);
  await assert.rejects(() => session.mutate(r => r), /尚未保存/);
  fail = false; await session.retry();
  assert.equal(challengeMetrics(session.record).completed, 1); assert.equal(fault, null);
  await session.retry(); assert.equal(challengeMetrics(session.record).completed, 1);
});
test("interrupting an in-flight save waits for its result, invalidates only pending work, and keeps final data immutable", async t => {
  const { store } = await storeFixture(t);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const session = new ChallengeSession(async r => { await gate; return store.save(r); }, () => {}, () => {}, recoverChallenge);
  session.load(await store.create(empty()));
  const p = pending(session.record, 0);
  const writing = session.mutate(() => p.next);
  const pausing = session.mutate(r => recoverChallenge(r, "保存期间退出"));
  release(); await writing; await pausing;
  const r = await store.get(session.record.id);
  assert.equal(r.status, "paused"); assert.equal(r.rounds[0].attempts[0].outcome, "invalid");
  assert.equal(challengeMetrics(r).completed, 0);
  const completed = full();
  await store.create({ ...completed, rounds: [], status: "paused", completedAt: null, restUntil: 0 });
  session.load(await store.save(completed));
  const revision = session.record.revision;
  await session.mutate(recoverChallenge);
  assert.equal(session.record.revision, revision);
  await assert.rejects(() => store.save({ ...session.record, name: "改名" }), /身份/);
});
test("lost save acknowledgements recover the committed result without duplicate rounds", async t => {
  const { store } = await storeFixture(t); let loseResponse = false;
  const session = new ChallengeSession(async r => {
    const saved = await store.save(r);
    if (loseResponse) { loseResponse = false; throw new Error("response lost after commit"); }
    return saved;
  }, () => {}, () => {}, recoverChallenge);
  session.load(await store.create(empty()));
  const p = pending(session.record, 0);
  await session.mutate(() => p.next);
  loseResponse = true;
  await assert.rejects(() => session.mutate(r => finishAttempt(r, p.id, p.result)));
  assert.equal(challengeMetrics(session.record).completed, 0);
  assert.equal(challengeMetrics(await store.get(session.record.id)).completed, 1);
  await session.retry();
  assert.equal(challengeMetrics(session.record).completed, 1);
  assert.equal(session.record.rounds[0].attempts.length, 1);
});
test("simulated decisions complete 30 rounds through the real session/store, with restart and interruption", async t => {
  const { directory } = await storeFixture(t);
  let store = new ChallengeStore(directory);
  let session = new ChallengeSession(r => store.save(r), () => {}, () => {}, recoverChallenge);
  session.load(await store.create(empty()));
  for (let i = 0; i < 30; i++) {
    let p = pending(session.record, i, i % 7 === 0 ? "rejected" : i % 5 === 0 ? "incorrect" : "correct", 2300 + i);
    await session.mutate(() => p.next);
    if (i === 12) {
      const id = session.record.id; store = new ChallengeStore(directory);
      session = new ChallengeSession(r => store.save(r), () => {}, () => {}, recoverChallenge);
      session.load(await store.get(id));
      await session.mutate(r => recoverChallenge(r, "模拟退出后恢复"));
      p = pending(session.record, i, "correct", 2312); await session.mutate(() => p.next);
    }
    await session.mutate(r => finishAttempt(r, p.id, p.result));
    if (i === 9 || i === 19) assert.ok(session.record.restUntil > Date.now());
  }
  const r = await new ChallengeStore(directory).get(session.record.id);
  assert.equal(r.status, "completed"); assert.equal(challengeMetrics(r).completed, 30);
  assert.equal(r.rounds.length, 30); assert.equal(r.rounds[12].attempts.filter(a => a.outcome === "invalid").length, 1);
  assert.equal(rankChallenges([r], "overall", config)[0].rank, 1);
});

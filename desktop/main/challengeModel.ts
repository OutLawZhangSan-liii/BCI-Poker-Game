/** Pure challenge rules shared by the renderer, persistence validation and tests. */
export const CHALLENGE_RULE_VERSION = "three-stage-v1-no-retry";
export const CHALLENGE_MODES = ["simple", "difficult1", "difficult2"] as const;
export type ChallengeMode = typeof CHALLENGE_MODES[number];
export type RankingStrategy = "overall" | "accuracy" | "speed" | "streak";
export interface ChallengeConfiguration { ruleVersion: string; classifier: string; stimulus: string; }
export interface ChallengeCard { rank: number; suit: "♠" | "♥" | "♣" | "♦"; }
export interface AttemptRecord {
  id: string; sessionId: string; trialId: string; preparedAt: string;
  outcome: "pending" | "correct" | "incorrect" | "rejected" | "invalid";
  selectedIndex: number | null; logicalStartMs: number | null; firstFrameMs: number | null;
  endedMs: number | null; elapsedMs: number | null; reason: string | null;
}
export interface RoundRecord {
  mode: ChallengeMode; index: number; reference: ChallengeCard; candidates: ChallengeCard[];
  correctIndex: number; attempts: AttemptRecord[];
}
export interface ChallengeRecord {
  schemaVersion: 1; id: string; revision: number; studentId: string; name: string;
  createdAt: string; updatedAt: string; completedAt: string | null;
  status: "running" | "paused" | "completed"; restUntil: number;
  configuration: ChallengeConfiguration; rounds: RoundRecord[];
}
export interface ChallengeMetrics {
  completed: number; firstCorrect: number; correct: number; incorrect: number; rejected: number;
  firstAccuracy: number; finalAccuracy: number; meanMs: number; correctMeanMs: number | null;
  longestStreak: number; streak: number; score: number;
}
export interface RankedChallenge { record: ChallengeRecord; metrics: ChallengeMetrics; rank: number; }
export const groupKey = (record: ChallengeRecord) => JSON.stringify(record.configuration);
export const isRoundComplete = (round: RoundRecord) => round.attempts.some(a => ["correct", "incorrect", "rejected"].includes(a.outcome));
export function challengeMetrics(record: ChallengeRecord, mode?: ChallengeMode): ChallengeMetrics {
  let completed = 0, firstCorrect = 0, correct = 0, rejected = 0, longestStreak = 0, streak = 0, score = 0, totalMs = 0, correctMs = 0;
  let previousMode: ChallengeMode | null = null;
  for (const round of record.rounds.filter(r => !mode || r.mode === mode)) {
    if (round.mode !== previousMode) streak = 0;
    previousMode = round.mode;
    const valid = round.attempts.filter(a => ["correct", "incorrect", "rejected"].includes(a.outcome));
    for (const attempt of valid) {
      if (attempt.outcome === "correct") { streak++; longestStreak = Math.max(longestStreak, streak); }
      else streak = 0;
      if (attempt.outcome === "rejected") rejected++;
    }
    if (!isRoundComplete(round)) continue;
    completed++;
    if (valid[0]?.outcome === "correct") firstCorrect++;
    const elapsed = valid.reduce((sum, a) => sum + a.elapsedMs!, 0);
    totalMs += elapsed;
    const last = valid.at(-1)!;
    if (last.outcome === "correct") {
      correct++; correctMs += elapsed;
      score += 100 + Math.round(50 * Math.max(0, Math.min(1, (3500 - last.elapsedMs!) / 2000)));
    }
  }
  return { completed, firstCorrect, correct, incorrect: completed - correct - rejected, rejected,
    firstAccuracy: completed ? firstCorrect / completed : 0, finalAccuracy: completed ? correct / completed : 0,
    meanMs: completed ? totalMs / completed : 0, correctMeanMs: correct ? correctMs / correct : null,
    longestStreak, streak, score };
}
export function rankChallenges(records: ChallengeRecord[], strategy: RankingStrategy, configuration: ChallengeConfiguration): RankedChallenge[] {
  const key = JSON.stringify(configuration);
  const rows = records.filter(r => r.status === "completed" && groupKey(r) === key && challengeMetrics(r).completed === 30)
    .map(record => ({ record, metrics: challengeMetrics(record), rank: 0 }))
    .filter(row => strategy !== "speed" || row.metrics.firstCorrect >= 21);
  const compare = (a: RankedChallenge, b: RankedChallenge) => {
    const x = a.metrics, y = b.metrics;
    if (strategy === "accuracy") return y.firstCorrect - x.firstCorrect || y.correct - x.correct || x.rejected - y.rejected;
    if (strategy === "speed") return x.correctMeanMs! - y.correctMeanMs! || y.firstCorrect - x.firstCorrect;
    if (strategy === "streak") return y.longestStreak - x.longestStreak || y.firstCorrect - x.firstCorrect || x.meanMs - y.meanMs;
    return y.firstCorrect - x.firstCorrect || x.meanMs - y.meanMs || y.longestStreak - x.longestStreak;
  };
  rows.sort((a, b) => compare(a, b) || a.record.completedAt!.localeCompare(b.record.completedAt!) || a.record.id.localeCompare(b.record.id));
  rows.forEach((row, i) => { row.rank = i && compare(row, rows[i - 1]) === 0 ? rows[i - 1].rank : i + 1; });
  return rows;
}
export function createChallenge(id: string, studentId: string, name: string, configuration: ChallengeConfiguration, now = new Date().toISOString()): ChallengeRecord {
  const record: ChallengeRecord = { schemaVersion: 1, id, revision: 0, studentId: studentId.trim(), name: name.trim(),
    createdAt: now, updatedAt: now, completedAt: null, status: "paused", restUntil: 0, configuration, rounds: [] };
  validateChallenge(record); return record;
}
export function finishAttempt(record: ChallengeRecord, attemptId: string, result: Pick<AttemptRecord, "outcome" | "selectedIndex" | "logicalStartMs" | "firstFrameMs" | "endedMs" | "reason">, now = Date.now()): ChallengeRecord {
  const next = structuredClone(record);
  const round = next.rounds.find(r => r.attempts.some(a => a.id === attemptId));
  const attempt = round?.attempts.find(a => a.id === attemptId);
  if (!attempt) throw new Error("尝试记录不存在");
  if (attempt.outcome !== "pending") return next; // Repeated callbacks never count twice.
  if (result.outcome === "pending") throw new Error("尝试尚未结束");
  Object.assign(attempt, result, { elapsedMs: result.outcome === "invalid" ? null : result.endedMs! - result.firstFrameMs! });
  const completed = challengeMetrics(next).completed;
  if (completed === 30) { next.status = "completed"; next.completedAt = new Date(now).toISOString(); next.restUntil = 0; }
  else if (isRoundComplete(round!) && completed % 10 === 0) next.restUntil = now + 30_000;
  next.updatedAt = new Date(now).toISOString();
  validateChallenge(next); return next;
}
export function recoverChallenge(record: ChallengeRecord, reason = "应用重新打开，未完成尝试作废"): ChallengeRecord {
  const next = structuredClone(record);
  for (const round of next.rounds) for (const a of round.attempts) if (a.outcome === "pending") { a.outcome = "invalid"; a.reason = reason; }
  if (next.status !== "completed") next.status = "paused";
  return next;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const validChallengeId = (id: unknown): id is string => typeof id === "string" && uuid.test(id);
const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0;
function check(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(`挑战记录无效：${message}`); }
export function validateChallenge(value: unknown): asserts value is ChallengeRecord {
  const r = value as ChallengeRecord;
  check(r && r.schemaVersion === 1 && validChallengeId(r.id), "版本或编号");
  check(Number.isInteger(r.revision) && r.revision >= 0, "保存版本");
  for (const [label, text, limit] of [["学号", r.studentId, 80], ["姓名", r.name, 80]] as const)
    check(typeof text === "string" && text.trim() === text && text.length > 0 && text.length <= limit && !/[\x00-\x1f]/.test(text), label);
  check(["running", "paused", "completed"].includes(r.status) && finite(r.restUntil), "状态");
  check([r.createdAt, r.updatedAt].every(x => typeof x === "string" && Number.isFinite(Date.parse(x))), "日期");
  check(r.configuration && Object.keys(r.configuration).sort().join() === "classifier,ruleVersion,stimulus", "配置");
  check(Object.values(r.configuration).every(x => typeof x === "string" && x.length > 0 && x.length <= 30000), "配置内容");
  check(r.configuration.ruleVersion === CHALLENGE_RULE_VERSION, "规则版本");
  check(Array.isArray(r.rounds) && r.rounds.length <= 30, "轮数");
  const ids = new Set<string>(), trials = new Set<string>();
  const card = (c: ChallengeCard) => c && Number.isInteger(c.rank) && c.rank >= 1 && c.rank <= 13 && ["♠", "♥", "♣", "♦"].includes(c.suit);
  r.rounds.forEach((round, i) => {
    const count = [2, 4, 6][Math.floor(i / 10)];
    check(round && round.mode === CHALLENGE_MODES[Math.floor(i / 10)] && round.index === i % 10, "关卡顺序");
    check(i === 0 || isRoundComplete(r.rounds[i - 1]), "上一轮尚未完成");
    check(card(round.reference) && Array.isArray(round.candidates) && round.candidates.length === count && round.candidates.every(card), "手牌");
    const eligible = round.candidates.map(c => c.rank).filter(x => x > round.reference.rank);
    check(eligible.length && Number.isInteger(round.correctIndex) && round.correctIndex >= 0 && round.correctIndex < count
      && round.candidates[round.correctIndex].rank === Math.min(...eligible), "正确答案");
    check(Array.isArray(round.attempts) && round.attempts.length <= 10000, "尝试列表");
    let terminal = false;
    round.attempts.forEach((a, j) => {
      check(!terminal && a && validChallengeId(a.id) && !ids.has(a.id), "重复或已结束的尝试"); ids.add(a.id);
      check(typeof a.sessionId === "string" && a.sessionId.length > 0 && a.sessionId.length <= 200 && validChallengeId(a.trialId) && !trials.has(a.trialId), "EEG 关联"); trials.add(a.trialId);
      check(typeof a.preparedAt === "string" && Number.isFinite(Date.parse(a.preparedAt)), "尝试日期");
      check(["pending", "invalid", "correct", "incorrect", "rejected"].includes(a.outcome), "尝试结果");
      if (a.outcome === "pending") { check(j === round.attempts.length - 1 && i === r.rounds.length - 1 && a.elapsedMs === null, "进行中的尝试"); return; }
      if (a.outcome === "invalid") { check(typeof a.reason === "string" && a.reason.length > 0 && a.elapsedMs === null, "无效原因"); return; }
      check(finite(a.logicalStartMs) && finite(a.firstFrameMs) && finite(a.endedMs) && a.firstFrameMs >= a.logicalStartMs && a.endedMs >= a.firstFrameMs
        && finite(a.elapsedMs) && Math.abs(a.elapsedMs - (a.endedMs - a.firstFrameMs)) < .000001, "单调时钟耗时");
      if (a.outcome === "rejected") { check(a.selectedIndex === null, "拒识结果"); terminal = true; }
      else {
        check(Number.isInteger(a.selectedIndex) && a.selectedIndex! >= 0 && a.selectedIndex! < count, "选择结果");
        check((a.selectedIndex === round.correctIndex) === (a.outcome === "correct"), "结果与手牌不符"); terminal = true;
      }
    });
  });
  const completed = r.rounds.filter(isRoundComplete).length === 30;
  check(completed === (r.status === "completed") && (completed ? typeof r.completedAt === "string" && Number.isFinite(Date.parse(r.completedAt)) : r.completedAt === null), "完成状态");
}

/** Saved history is append-only; only an unfinished attempt may be resolved. */
export function validateChallengeTransition(previous: ChallengeRecord, next: ChallengeRecord): void {
  validateChallenge(next);
  check(next.id === previous.id && next.revision === previous.revision && next.studentId === previous.studentId && next.name === previous.name
    && next.createdAt === previous.createdAt && groupKey(next) === groupKey(previous), "身份、配置或保存版本变化");
  check(previous.status !== "completed" || JSON.stringify(previous) === JSON.stringify(next), "已完成成绩不可修改");
  check(next.rounds.length >= previous.rounds.length, "轮次被删除");
  previous.rounds.forEach((round, i) => {
    const nr = next.rounds[i];
    check(JSON.stringify({ ...round, attempts: [] }) === JSON.stringify({ ...nr, attempts: [] }) && nr.attempts.length >= round.attempts.length, "手牌或历史被改写");
    round.attempts.forEach((a, j) => {
      if (a.outcome === "pending") check(["id", "trialId", "sessionId", "preparedAt"].every(k => a[k as keyof AttemptRecord] === nr.attempts[j][k as keyof AttemptRecord]), "尝试身份变化");
      else check(JSON.stringify(a) === JSON.stringify(nr.attempts[j]), "已确认的尝试被改写");
    });
  });
}

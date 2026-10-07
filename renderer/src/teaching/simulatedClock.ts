export interface SimulatedClockState { accumulatedSeconds: number; startedAtMs: number | null; }

export type SimulatedAnalysisStatus = "未开始" | "正在积累分析窗口" | "正在重新积累" | "运行中" | "已暂停";

export function createSimulatedClock(): SimulatedClockState { return { accumulatedSeconds: 0, startedAtMs: null }; }

export function effectiveSimulatedSeconds(clock: SimulatedClockState, nowMs: number): number {
  return clock.accumulatedSeconds + (clock.startedAtMs === null ? 0 : Math.max(0, (nowMs - clock.startedAtMs) / 1000));
}

export function startSimulatedClock(clock: SimulatedClockState, nowMs: number) {
  if (clock.startedAtMs === null) clock.startedAtMs = nowMs;
}

export function pauseSimulatedClock(clock: SimulatedClockState, nowMs: number) {
  if (clock.startedAtMs !== null) { clock.accumulatedSeconds = effectiveSimulatedSeconds(clock, nowMs); clock.startedAtMs = null; }
  return clock.accumulatedSeconds;
}

export function resetSimulatedClock(clock: SimulatedClockState, nowMs: number, running: boolean) {
  clock.accumulatedSeconds = 0; clock.startedAtMs = running ? nowMs : null;
}

/** Discard the delayed interval after a long block and begin a fresh clock epoch. */
export function recoverSimulatedClockAfterBlock(clock: SimulatedClockState, nowMs: number) {
  clock.accumulatedSeconds = 0;
  clock.startedAtMs = nowMs;
  return clock;
}

export function recoverSimulatedAnalysisState(clock: SimulatedClockState, nowMs: number) {
  recoverSimulatedClockAfterBlock(clock, nowMs);
  return { cursor: 0, samples: new Float32Array() };
}

export function getSimulatedAnalysisStatus(running: boolean, sampleCount: number, windowSize: number, hasRecoveryNotice: boolean): SimulatedAnalysisStatus {
  if (running) return sampleCount < windowSize ? (hasRecoveryNotice ? "正在重新积累" : "正在积累分析窗口") : "运行中";
  return sampleCount > 0 ? "已暂停" : "未开始";
}

export function getSimulatedAnalysisHint(status: SimulatedAnalysisStatus, sampleCount: number, windowSize: number): string {
  if (status === "未开始") return "请点击“开始模拟分析”";
  if (status === "正在重新积累") return `正在重新积累分析窗口；达到 ${windowSize} 点后恢复运行。`;
  if (status === "正在积累分析窗口") return `正在积累分析窗口；达到 ${windowSize} 点后才计算 PSD，不预填数据。`;
  if (status === "已暂停") return sampleCount < windowSize ? "已暂停；继续后将重新积累分析窗口。" : "已暂停；继续后从当前窗口继续采样。";
  return "分析窗口已满，当前状态为运行中。";
}

export function samplesDueForClock(clock: SimulatedClockState, nowMs: number, sampleRateHz: number) {
  return Math.floor(effectiveSimulatedSeconds(clock, nowMs) * sampleRateHz);
}

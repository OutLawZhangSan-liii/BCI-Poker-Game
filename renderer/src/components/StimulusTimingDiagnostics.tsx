import { useEffect, useMemo, useRef, useState } from "react";
import { StimulusTable } from "./StimulusTable";
import { SIMPLE_TARGETS, type StimulusFrameStats, type StimulusTarget } from "../bci/stimulus/types";
import { measureDisplayRefreshRate } from "../bci/stimulus/refreshRate";
import { GAME_STIMULUS_MS } from "../game/eegSelection";
import { SHORT_FIXATION_PROTOCOL, COMPARISON_ANALYSIS_WINDOWS, SHORT_BASELINE_MS as COMPARISON_BASELINE_MS, SHORT_BREAK_MS as COMPARISON_BREAK_MS, COMPARISON_CUE_MS, SHORT_HALFWAY_COUNT as COMPARISON_HALFWAY_COUNT, SHORT_REST_MS as COMPARISON_REST_MS, COMPARISON_STIMULUS_MS, SHORT_TRIAL_COUNT as COMPARISON_TRIAL_COUNT, createShortFixationSequence, diagnosticDataFresh, type FixationMode, type StimulusAppearance, type StimulusComparisonCondition } from "../bci/stimulus/comparison";
import type { ResponsiveStimulusGeometrySnapshot } from "../bci/stimulus/geometry";

export interface DiagnosticStimulusContext {
  appearance: StimulusAppearance;
  fixationPoint: "light-dark-concentric" | "light-dark-concentric-sync";
  fixationMode: FixationMode;
  eegFreshnessPolicy: "packet-jitter-tolerance-v1";
  geometry: ResponsiveStimulusGeometrySnapshot | null;
  targets: StimulusTarget[];
  activeTargetIds: string[];
  plannedDurationMs: number;
  modulationAmplitude: number;
  condition?: "static" | "12hz" | "15hz";
  comparisonRunId?: string;
  protocol?: string;
  sequenceIndex?: number;
  repetition?: number;
  segment?: 1 | 2;
  analysisWindowsSeconds?: typeof COMPARISON_ANALYSIS_WINDOWS;
  stimulusFootprint: "seat" | "card";
  outerFlicker: boolean;
  brightnessMethod: "static-card-overlay" | "black-overlay-linear-rgb-v2" | "uniform-rgb-v1";
}

export function StimulusTimingDiagnostics({ disabled, comparisonEnabled = false, getEegFreshness, onRunningChange, onFirstFrame, onComplete }: {
  disabled: boolean; comparisonEnabled?: boolean; onRunningChange: (running: boolean) => void;
  getEegFreshness?: () => { ageMs: number | null; packetDurationMs: number | null };
  onFirstFrame?: (performanceMs: number, mode: "left" | "right" | "both", refreshRateHz: number, context: DiagnosticStimulusContext) => void | Promise<void>;
  onComplete?: (stats: StimulusFrameStats, endReason: string) => void | Promise<void>;
}) {
  const [mode, setMode] = useState<"left" | "right" | "both">("both");
  const [appearance, setAppearance] = useState<StimulusAppearance>("card-face");
  const [fixationMode, setFixationMode] = useState<FixationMode>("fixed");
  const [comparing, setComparing] = useState(false);
  const [betweenSegments, setBetweenSegments] = useState(false);
  const [comparisonStatus, setComparisonStatus] = useState("");
  const [waiting, setWaiting] = useState<{ label: string; deadline: number } | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const comparison = useRef<{ runId: string; index: number; conditions: StimulusComparisonCondition[] } | null>(null);
  const [condition, setCondition] = useState<StimulusComparisonCondition | null>(null);
  const targets = useMemo<StimulusTarget[]>(() => condition ? [{ id: "diagnostic_center", frequencyHz: condition.frequencyHz, phaseRad: 0, label: "7♣", x: .5, y: .5 }] : SIMPLE_TARGETS, [condition]);
  const duration = useRef(GAME_STIMULUS_MS);
  const acquisitionWatchdog = useRef<ReturnType<typeof setInterval> | null>(null);
  const comparisonTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const geometry = useRef<ResponsiveStimulusGeometrySnapshot | null>(null);
  const endReason = useRef("diagnostic_complete");
  const [running, setRunning] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [onset, setOnset] = useState<number>();
  const [refreshRate, setRefreshRate] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstFrameWatchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = useRef(false);
  const awaitingFirstFrame = useRef(false);
  const trialStarted = useRef(false);
  const runningChange = useRef(onRunningChange); runningChange.current = onRunningChange;
  const stop = (reason = "diagnostic_stopped") => {
    endReason.current = reason;
    if (comparison.current) setComparisonStatus("对照已停止，本次未完成");
    generation.current++;
    if (timer.current !== null) clearTimeout(timer.current);
    if (firstFrameWatchdog.current !== null) clearTimeout(firstFrameWatchdog.current);
    if (comparisonTimer.current !== null) clearTimeout(comparisonTimer.current);
    if (acquisitionWatchdog.current !== null) clearInterval(acquisitionWatchdog.current); acquisitionWatchdog.current = null;
    comparisonTimer.current = null; comparison.current = null; setComparing(false);
    timer.current = firstFrameWatchdog.current = null; busy.current = false; awaitingFirstFrame.current = false;
    setWaiting(null); setBetweenSegments(false); setRunning(false); setPreparing(false); runningChange.current(false);
  };
  useEffect(() => {
    const hidden = () => { if (document.hidden && (busy.current || comparison.current)) { stop("window_hidden"); setNotice("窗口已隐藏，测试已停止"); } };
    document.addEventListener("visibilitychange", hidden);
    return () => { generation.current++; comparison.current = null; if (acquisitionWatchdog.current !== null) clearInterval(acquisitionWatchdog.current); if (firstFrameWatchdog.current !== null) clearTimeout(firstFrameWatchdog.current); if (comparisonTimer.current !== null) clearTimeout(comparisonTimer.current); if (timer.current !== null) clearTimeout(timer.current); document.removeEventListener("visibilitychange", hidden); runningChange.current(false); };
  }, []);
  useEffect(() => {
    if (!waiting) return;
    const update = () => setRemainingSeconds(Math.max(0, Math.ceil((waiting.deadline - performance.now()) / 1000)));
    update(); const countdown = setInterval(update, 1000); return () => clearInterval(countdown);
  }, [waiting]);
  const freshData = () => { const value = getEegFreshness?.(); return Boolean(value && diagnosticDataFresh(value.ageMs, value.packetDurationMs, "short")); };
  const start = async (manual = false) => {
    if (disabled || busy.current) return;
    if (document.hidden) { setNotice("请保持窗口可见后开始测试"); return; }
    if (comparison.current && !freshData()) { stop("eeg_data_stale"); setNotice("EEG 数据未持续到达，测试已停止，请检查采集连接"); return; }
    if (manual) setCondition(null);
    duration.current = comparison.current ? COMPARISON_STIMULUS_MS : GAME_STIMULUS_MS;
    busy.current = true;
    const revision = ++generation.current;
    if (!comparison.current) setComparisonStatus("");
    setWaiting(null); setPreparing(true); setNotice(""); runningChange.current(true);
    try {
      const rate = await measureDisplayRefreshRate(60);
      if (revision !== generation.current) return;
      setRefreshRate(rate); setOnset(undefined); setPreparing(false);
      awaitingFirstFrame.current = true; setRunning(true);
      endReason.current = "diagnostic_complete";
      firstFrameWatchdog.current = setTimeout(() => {
        firstFrameWatchdog.current = null;
        if (awaitingFirstFrame.current) { stop("first_frame_timeout"); setNotice("刺激未能启动：没有收到首帧，请保持窗口可见后重试"); }
      }, 2000);
    } catch (cause) { if (revision === generation.current) { stop(); setNotice((cause as Error).message); } }
  };
  const startRef = useRef(start); startRef.current = start;
  const nextComparison = () => {
    const run = comparison.current; if (!run) return;
    const next = run.conditions[run.index];
    setCondition(next); setAppearance(next.appearance ?? "solid");
    setFixationMode(next.fixationMode ?? "fixed");
    setComparisonStatus(`短版 · ${run.index + 1}/${COMPARISON_TRIAL_COUNT} · ${next.appearance === "card" ? "原外围闪烁" : next.appearance === "card-face" ? "整牌闪烁（无外围）" : "纯色块（同牌面尺寸）"} · ${next.fixationMode === "synchronous" ? "同步闪烁注视点" : "固定注视点"} · ${next.condition === "static" ? "一次性静态参考" : `${next.frequencyHz} Hz 刺激 · 第 ${next.repetition}/2 组`} · 请持续注视中央标记点`);
    setWaiting({ label: "注视准备", deadline: performance.now() + COMPARISON_CUE_MS });
    comparisonTimer.current = setTimeout(() => { comparisonTimer.current = null; if (comparison.current === run) void startRef.current(); }, COMPARISON_CUE_MS);
  };
  const nextComparisonRef = useRef(nextComparison); nextComparisonRef.current = nextComparison;
  const startComparison = () => {
    if (disabled || !comparisonEnabled || busy.current || comparison.current || running || preparing || comparing || document.hidden) return;
    if (!freshData()) { setNotice("请确认 EEG 数据持续到达后开始对照"); return; }
    comparison.current = { runId: crypto.randomUUID(), index: 0, conditions: createShortFixationSequence() }; setComparing(true); setBetweenSegments(false); setNotice("");
    setCondition({ condition: "static", frequencyHz: 0, repetition: 0 }); setAppearance("solid");
    setComparisonStatus("睁眼看屏幕，保持头部稳定；倒计时结束后自动开始");
    setWaiting({ label: "静息阶段", deadline: performance.now() + COMPARISON_BASELINE_MS }); runningChange.current(true);
    comparisonTimer.current = setTimeout(() => { comparisonTimer.current = null; nextComparisonRef.current(); }, COMPARISON_BASELINE_MS);
  };
  useEffect(() => { if (!comparisonEnabled && comparison.current) { setComparisonStatus("EEG 采集已停止，对照已取消"); stop("acquisition_stopped"); } }, [comparisonEnabled]);
  const resumeComparison = () => {
    if (!comparison.current || !betweenSegments || remainingSeconds > 0 || (waiting && performance.now() < waiting.deadline) || busy.current) return;
    if (!freshData()) { stop("eeg_data_stale"); setNotice("EEG 数据未持续到达，请检查采集连接后重新测试"); return; }
    setBetweenSegments(false); setWaiting(null); nextComparisonRef.current();
  };
  const complete = async (frameStats: StimulusFrameStats) => {
    if (!trialStarted.current) return;
    trialStarted.current = false;
    if (acquisitionWatchdog.current !== null) clearInterval(acquisitionWatchdog.current); acquisitionWatchdog.current = null;
    if (timer.current !== null) clearTimeout(timer.current); timer.current = null;
    setRunning(false);
    const revision = generation.current;
    try { await onComplete?.(frameStats, endReason.current); }
    catch { if (revision === generation.current) { stop("marker_write_failed"); setNotice("试次标记保存失败，测试已停止，请检查网关连接"); } return; }
    if (revision !== generation.current) return;
    busy.current = false;
    const run = comparison.current; if (!run) { runningChange.current(false); return; }
    if (++run.index >= run.conditions.length) {
      comparison.current = null; setComparing(false); setComparisonStatus(`${COMPARISON_TRIAL_COUNT} 次对照已完成，请记录漏看或移动的试次，并回复完成`); runningChange.current(false); return;
    }
    if (run.index === COMPARISON_HALFWAY_COUNT) {
      setBetweenSegments(true); setRemainingSeconds(Math.ceil(COMPARISON_BREAK_MS / 1000)); setComparisonStatus(`第一段 ${COMPARISON_HALFWAY_COUNT} 次已完成；休息后点击「继续第二段」，保持当前采集与显示条件`);
      setWaiting({ label: "段间休息", deadline: performance.now() + COMPARISON_BREAK_MS }); return;
    }
    setComparisonStatus(`已完成 ${run.index}/${COMPARISON_TRIAL_COUNT} · 保持头部稳定`);
    setWaiting({ label: "休息阶段", deadline: performance.now() + COMPARISON_REST_MS });
    comparisonTimer.current = setTimeout(() => { comparisonTimer.current = null; if (comparison.current === run) nextComparisonRef.current(); }, COMPARISON_REST_MS);
  };
  return <article className="card stimulus-timing-diagnostics" aria-label="刺激时序诊断">
    <h2>刺激时序诊断</h2>
    <div className="timing-diagnostic-controls"><label>测试模式 <select aria-label="时序测试模式" value={mode} disabled={running || preparing || comparing} onChange={event => { setMode(event.target.value as typeof mode); setCondition(null); setNotice(""); }}><option value="left">12 Hz</option><option value="right">15 Hz</option><option value="both">双刺激 12 / 15 Hz</option></select></label>
      <label>刺激形式 <select aria-label="诊断刺激形式" value={appearance} disabled={running || preparing || comparing} onChange={event => { setAppearance(event.target.value as StimulusAppearance); setCondition(null); }}><option value="card-face">整牌闪烁（无外围）</option><option value="solid">纯色块（同牌面尺寸）</option><option value="card">原外围闪烁</option></select></label>
      <label>注视点 <select aria-label="诊断注视点模式" value={fixationMode} disabled={running || preparing || comparing} onChange={event => { setFixationMode(event.target.value as FixationMode); setCondition(null); }}><option value="fixed">固定</option><option value="synchronous">同步闪烁</option></select></label>
      <button disabled={disabled || running || preparing || comparing} onClick={() => void start(true)}>开始时序测试</button>
      <button disabled={disabled || !comparisonEnabled || running || preparing || comparing} onClick={startComparison}>开始注视对照</button>
      {betweenSegments && <button disabled={remainingSeconds > 0 || !comparisonEnabled} onClick={resumeComparison}>继续第二段</button>}
      <button className="secondary" disabled={!running && !preparing && !comparing} onClick={() => stop()}>停止测试</button>
      <span role="status">{preparing ? "检测刷新率" : running ? condition?.condition === "static" ? "静态记录中" : "闪烁中" : comparing ? "对照进行中" : "未运行"}</span>
    </div>
    <p className="timing-diagnostic-notice" role="status">{notice || <>{waiting && <strong>{waiting.label} · {remainingSeconds} 秒　</strong>}{comparisonStatus || "短版对照：三种形式 × 固定 / 同步闪烁注视点，12 / 15 Hz 各 2 次；每种组合仅一次静态参考，共 30 次，约 11 分钟。先静息 20 秒，每次 10 秒，间隔休息 6 秒；第 18 次后休息 60 秒，手动继续。用于初步筛选。"}</>}</p>
    <div className="timing-diagnostic-stage"><StimulusTable active={running} targets={targets} targetAppearance={appearance} activeTargetIndex={condition ? 0 : mode === "left" ? 0 : mode === "right" ? 1 : null}
      stimulusFootprint={appearance === "card" ? "seat" : "card"} fixationMode={fixationMode}
      modulationAmplitude={condition?.condition === "static" ? 0 : .45}
      showReference={false} showFrequencyLabels={!condition} targetSize="diagnostic-large" showSolidFixationPoint refreshRateHz={refreshRate ?? 60} stimulusStartTimestamp={onset} stimulusEndTimestamp={onset === undefined ? undefined : onset + duration.current}
      onGeometryChange={snapshot => { geometry.current = snapshot; }}
      onFirstFrame={performanceMs => {
        if (!awaitingFirstFrame.current) return;
        if (comparison.current && !freshData()) { stop("eeg_data_stale"); setNotice("EEG 数据到达停滞，测试已停止，本次未记录有效试次"); return; }
        awaitingFirstFrame.current = false; trialStarted.current = true;
        if (firstFrameWatchdog.current !== null) clearTimeout(firstFrameWatchdog.current); firstFrameWatchdog.current = null;
        setOnset(performanceMs);
        timer.current = setTimeout(() => { timer.current = null; setRunning(false); }, duration.current);
        if (comparison.current) acquisitionWatchdog.current = setInterval(() => {
          if (!freshData()) { stop("eeg_data_stale"); setNotice("EEG 数据到达停滞，本次对照已停止，请检查采集连接"); }
        }, 100);
        const run = comparison.current;
        const revision = generation.current;
        const activeTargetIds = condition?.condition === "static" ? [] : condition ? [targets[0].id] : mode === "both" ? targets.map(t => t.id) : [targets[mode === "left" ? 0 : 1].id];
        void Promise.resolve(onFirstFrame?.(performanceMs, mode, refreshRate ?? 60, {
        appearance, fixationPoint: fixationMode === "synchronous" ? "light-dark-concentric-sync" : "light-dark-concentric", fixationMode, eegFreshnessPolicy: "packet-jitter-tolerance-v1", geometry: geometry.current, comparisonRunId: run?.runId,
        targets, activeTargetIds, plannedDurationMs: duration.current, modulationAmplitude: condition?.condition === "static" ? 0 : .45, condition: run ? condition?.condition : undefined,
        protocol: run ? SHORT_FIXATION_PROTOCOL : undefined, sequenceIndex: run?.index,
        repetition: run ? run.conditions[run.index].repetition : undefined,
        segment: run ? run.conditions[run.index].segment : undefined,
        analysisWindowsSeconds: run ? COMPARISON_ANALYSIS_WINDOWS : undefined,
        stimulusFootprint: appearance === "card" ? "seat" : "card", outerFlicker: appearance === "card",
        brightnessMethod: appearance === "card-face" ? "black-overlay-linear-rgb-v2" : appearance === "solid" ? "uniform-rgb-v1" : "static-card-overlay",
      })).catch(() => { if (revision === generation.current) { stop("marker_write_failed"); setNotice("试次标记保存失败，测试已停止，请检查网关连接"); } }); }}
      onFrameStats={complete} onTimingDisruption={() => {}} onTimingFault={() => { setNotice("严重或持续丢帧，测试已停止"); stop("display_timing_fault"); }}
      onResizeWhileActive={() => { setNotice("显示尺寸变化，测试已停止"); stop("display_resize"); }} /></div>
  </article>;
}

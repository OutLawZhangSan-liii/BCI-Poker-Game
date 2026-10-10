import { useEffect, useMemo, useRef, useState } from "react";
import { GatewayClient } from "../bci/gatewayClient";
import type { EegChunk } from "../bci/protocol";
import { ANALYSIS_LEADS, missingAnalysisLeads } from "../bci/signal/leads";
import { fbccaDecisionPolicy, FBCCA_POLICY_VERSION } from "../bci/signal/decisionPolicy";
import type { WorkerInput, WorkerOutput } from "../bci/signal/types";
import { StimulusTable } from "../components/StimulusTable";
import { AppHeader } from "../components/AppHeader";
import { measureDisplayRefreshRate } from "../bci/stimulus/refreshRate";
import type { ResponsiveStimulusGeometrySnapshot } from "../bci/stimulus/geometry";
import type { StimulusFrameStats } from "../bci/stimulus/types";
import { STIMULUS_TIMING_VERSION } from "../bci/stimulus/phase";
import { createLabRun, recoverLabRun, pendingItems, completedItemIds, labTargets, labTemplate, labCueLabel, LAB_PROTOCOL, LAB_TIMING, FORM_LABELS, FORMS, type LabRun, type LabItem, type TargetCount } from "./protocol";
import "./lab.css";

interface Device { sample_rate_hz: number; channel_count: number; lead_names: string[]; samples_per_packet: number; }
const delay = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) return reject(new Error(String(signal.reason)));
  const abort = () => { clearTimeout(timer); reject(new Error(String(signal.reason))); };
  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
  signal.addEventListener("abort", abort, { once: true });
});
export function StimulusLab() {
  const client = useRef(new GatewayClient()), worker = useRef<Worker | null>(null);
  const runRef = useRef<LabRun | null>(null), session = useRef<string | null>(null), deviceRef = useRef<Device | null>(null);
  const latest = useRef<{ at: number; chunk: EegChunk } | null>(null), baselineSession = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null), activeAttempt = useRef<{ item: LabItem; trialId: string; onset?: number; marker?: Promise<unknown>; endWritten?: boolean } | null>(null);
  const geometry = useRef<ResponsiveStimulusGeometrySnapshot | null>(null), frames = useRef<StimulusFrameStats | null>(null);
  const firstResolve = useRef<((value: number) => void) | null>(null), endResolve = useRef<((value: StimulusFrameStats) => void) | null>(null);
  const [run, setRun] = useState<LabRun | null>(null), [records, setRecords] = useState<{id: string; createdAt: string; completed: number}[]>([]);
  const [connected, setConnected] = useState(false), [device, setDevice] = useState<Device | null>(null), [acquiring, setAcquiring] = useState(false);
  const [busy, setBusy] = useState(false), [working, setWorking] = useState(false), [active, setActive] = useState(false);
  const [item, setItem] = useState<LabItem | null>(null), [count, setCount] = useState<TargetCount>(2), [form, setForm] = useState<(typeof FORMS)[number]>("solid");
  const [stage, setStage] = useState("等待设置实验"), [error, setError] = useState(""), [deadline, setDeadline] = useState(0), [now, setNow] = useState(Date.now());
  const [refresh, setRefresh] = useState(60), [endTimestamp, setEndTimestamp] = useState<number>();
  const [badTrials, setBadTrials] = useState<string[]>([]), [comfort, setComfort] = useState(0), [analysis, setAnalysis] = useState<unknown>(null), [reportFinal, setReportFinal] = useState(false);
  const abort = (reason: string) => { controller.current?.abort(reason); setActive(false); };
  const save = async (next: LabRun) => { const saved = await window.brainGameDesktop.labSave(next) as LabRun; runRef.current = saved; setRun(saved); return saved; };
  const marker = (data: Record<string, unknown>) => client.current.command<{ markerSampleIndex: string }>("stimulus_marker", { sessionId: session.current, ...data });
  const freshness = () => {
    const last = latest.current;
    return { lastEegAgeMs: last ? performance.now() - last.at : null, lastEegPacketDurationMs: last ? last.chunk.sampleCountPerChannel / last.chunk.sampleRateHz * 1000 : null };
  };
  const ready = () => {
    if (!client.current.connected || !session.current || !deviceRef.current) throw new Error("请先连接设备并开始采集");
    const missing = missingAnalysisLeads(deviceRef.current.lead_names); if (missing.length) throw new Error(`缺少导联：${missing.join(" / ")}`);
    const f = freshness(); if (f.lastEegAgeMs === null || f.lastEegAgeMs > Math.max(500, 3 * (f.lastEegPacketDurationMs ?? 0))) throw new Error("EEG 数据尚未就绪或已断流");
    const bounds = document.querySelector(".lab-table")?.getBoundingClientRect();
    if (!bounds || bounds.top<0 || bounds.left<0 || bounds.bottom>innerHeight || bounds.right>innerWidth) throw new Error("请最大化窗口，并将整个刺激区域显示在屏幕内");
  };
  const operation = async (action: () => Promise<void>) => { setWorking(true); setError(""); try { await action(); } catch (cause) { setError(String(cause)); } finally { setWorking(false); } };
  useEffect(() => {
    const w = new Worker(new URL("../bci/signal/signal.worker.ts", import.meta.url), { type: "module" }); worker.current = w;
    const onEeg = (event: Event) => {
      const chunk = (event as CustomEvent<EegChunk>).detail;
      if (chunk.sessionId !== session.current) return;
      if (latest.current && (chunk.gatewaySequence !== latest.current.chunk.gatewaySequence + 1n || chunk.firstSampleIndex !== latest.current.chunk.firstSampleIndex + BigInt(latest.current.chunk.sampleCountPerChannel))) abort("eeg_gap");
      latest.current = { at: performance.now(), chunk };
      if (chunk.transportGapSuspected) abort("transport_gap");
      if (!chunk.samples.every(Number.isFinite)) abort("nonfinite_eeg");
      if (deviceRef.current && (chunk.sampleRateHz !== deviceRef.current.sample_rate_hz || chunk.channelCount !== deviceRef.current.channel_count)) abort("device_dimensions_changed");
    };
    const onBinary = (event: Event) => { if (activeAttempt.current?.item.kind === "active") { const buffer = (event as CustomEvent<ArrayBuffer>).detail.slice(0); w.postMessage({ type: "eeg", buffer } satisfies WorkerInput, [buffer]); } };
    const disconnected = () => { setConnected(false); setAcquiring(false); session.current = null; abort("gateway_disconnected"); };
    const protocolError = () => abort("eeg_protocol_error");
    const hidden = () => { if (document.hidden) abort("window_hidden"); };
    w.onmessage = event => { const message = event.data as WorkerOutput; if (message.type === "error") abort("classifier_error: " + message.message); if (message.type === "decision" && activeAttempt.current?.trialId === message.decision.trialId) void client.current.command("bci_decision", message.decision as unknown as Record<string, unknown>).catch(() => abort("decision_save_failed")); };
    client.current.addEventListener("eeg", onEeg); client.current.addEventListener("eeg-binary", onBinary);
    client.current.addEventListener("disconnected", disconnected); client.current.addEventListener("protocol-error", protocolError);
    document.addEventListener("visibilitychange", hidden);
    const watch = setInterval(() => { setNow(Date.now()); if (controller.current && session.current) { try { ready(); } catch (cause) { abort(String(cause)); } } }, 250);
    void window.brainGameDesktop.labList().then(setRecords).catch(cause => setError(String(cause)));
    return () => { controller.current?.abort("component_unmounted"); clearInterval(watch); w.terminate(); worker.current = null; client.current.removeEventListener("eeg", onEeg); client.current.removeEventListener("eeg-binary", onBinary); client.current.removeEventListener("disconnected", disconnected); client.current.removeEventListener("protocol-error", protocolError); client.current.disconnect(); document.removeEventListener("visibilitychange", hidden); };
  }, []);
  const connect = () => operation(async () => {
    const connection = await window.brainGameDesktop.getGatewayConnection(); if (!connection) throw new Error("设备网关尚未就绪");
    await client.current.connect(connection); setConnected(true);
    const result = await client.current.command<Device>("get_device_properties"); deviceRef.current = result.data; setDevice(result.data);
  });
  const startAcquisition = () => operation(async () => {
    const result = await client.current.command<Device>("get_device_properties"); deviceRef.current = result.data; setDevice(result.data);
    const missing = missingAnalysisLeads(result.data.lead_names); if (missing.length) throw new Error(`正式实验需要 ${ANALYSIS_LEADS.join(" / ")}；缺少 ${missing.join(" / ")}`);
    const id = crypto.randomUUID(); session.current = id; latest.current = null;
    try { await client.current.command("start_acquisition", { sessionId: id }); setAcquiring(true); } catch (cause) { session.current = null; throw cause; }
  });
  const stopAcquisition = () => operation(async () => { await client.current.command("stop_acquisition"); setAcquiring(false); session.current = null; latest.current = null; });
  const newRun = () => operation(async () => { const seed = crypto.getRandomValues(new Uint32Array(1))[0]; await save(createLabRun(crypto.randomUUID(), seed)); setAnalysis(null); setStage("实验已建立 · 共 216 次主动试次 + 9 次静态参考"); setRecords(await window.brainGameDesktop.labList()); });
  const load = (id: string) => operation(async () => { if (!id) return; await save(recoverLabRun(await window.brainGameDesktop.labLoad(id) as LabRun)); setAnalysis(null); setStage("已载入实验 · 可继续未完成批次"); });
  const waitStage = async (label: string, ms: number, signal: AbortSignal) => { setStage(label); setDeadline(Date.now() + ms); await delay(ms, signal); setDeadline(0); };
  const onFirstFrame = (onset: number) => {
    const attempt = activeAttempt.current; if (!attempt || attempt.onset !== undefined || controller.current?.signal.aborted) return;
    if (JSON.stringify(geometry.current) !== runRef.current!.geometrySignatures?.[attempt.item.count]) { abort("first_frame_geometry_changed"); return; }
    attempt.onset = onset; setEndTimestamp(onset + LAB_TIMING.stimulus); setDeadline(Date.now()+LAB_TIMING.stimulus);
    const current = attempt.item, targetList = labTargets(current.count);
    attempt.marker = marker({ markerType: "stimulus_start", trialId: attempt.trialId, trialKind: "stimulus_lab", comparisonProtocol: LAB_PROTOCOL, comparisonRunId: runRef.current!.id,
      planItemId: current.id, repetition: current.group, batch: current.batch, split: current.split, condition: current.kind, cuedTargetIndex: current.cue, attentionConfirmed: false,
      targetCount: current.count, targetAppearance: current.appearance, targets: targetList, activeTargetIds: current.kind === "active" ? targetList.map(t => t.id) : [],
      rendererPerformanceMs: onset, rendererCallbackDelayMs: Math.max(0, performance.now() - onset), synchronizationMethod: "gateway-arrival-estimate", hardwareSynchronized: false,
      plannedRefreshRateHz: refresh, plannedDurationMs: LAB_TIMING.stimulus, luminanceBaseline: .5, modulationAmplitude: current.kind === "static" ? 0 : .45, modulationDepth: 1,
      fixationMode: "fixed", stimulusTimingVersion: STIMULUS_TIMING_VERSION, responsiveStimulusGeometry: geometry.current,
      stimulusFootprint: current.appearance === "card" ? "seat" : "card", outerFlicker: current.appearance === "card", baselineCommit: runRef.current!.baselineCommit,
      modulatedRegionGeometry: geometry.current?.targets.map(t => current.appearance === "card" ? { outer: t.ring, excluded: t.card } : { outer: t.card, excluded: null }),
      rgbLevelMapping: "round(42+178*luminance)", brightnessMethod: current.appearance === "card" ? "static-card-overlay" : current.appearance === "card-face" ? "black-overlay-linear-rgb-v1" : "uniform-rgb-v1",
      decisionPolicyVersion: FBCCA_POLICY_VERSION, signalConfig: { windowSeconds: 2.5, hopSeconds: .25, harmonics: 3, ...fbccaDecisionPolicy(current.count) }, ...freshness() });
    attempt.marker.then(result => {
      if (activeAttempt.current !== attempt || controller.current?.signal.aborted) return;
      const firstSampleIndex = (result as {data: {markerSampleIndex: string}}).data.markerSampleIndex;
      worker.current?.postMessage({ type: "set_trial_marker", sessionId: session.current!, trialId: attempt.trialId, firstSampleIndex } satisfies WorkerInput);
      firstResolve.current?.(onset);
    }).catch(() => abort("start_marker_failed"));
  };
  const onFrames = (stats: StimulusFrameStats) => { frames.current = stats; endResolve.current?.(stats); endResolve.current = null; };
  const writeEnd = async (reason: string, stats: StimulusFrameStats | null) => {
    const attempt = activeAttempt.current; if (!attempt || attempt.onset === undefined || attempt.endWritten) return;
    await attempt.marker; attempt.endWritten = true;
    await marker({ markerType: "stimulus_end", trialId: attempt.trialId, endReason: reason, rendererPerformanceMs: stats?.lastFramePerformanceMs ?? performance.now(), rendererCallbackDelayMs: stats ? Math.max(0, performance.now() - stats.lastFramePerformanceMs) : null, ...stats, ...freshness() });
  };
  const startBatch = async () => {
    if (controller.current || !runRef.current) return;
    const control = new AbortController(); controller.current = control; setBusy(true); setError("");
    let completeBatch = false;
    try {
      ready();
      const pending = pendingItems(runRef.current), batch = pending[0]?.batch;
      if (batch === undefined) throw new Error("全部试次已完成");
      if (Date.now() < runRef.current.breakUntil) throw new Error("请完成批次间休息后继续");
      const rows = pending.filter(t => t.batch === batch);
      if (runRef.current.attempts.some(a => a.status === "complete" && a.attention === "pending")) throw new Error("请先确认上一批的实际注视情况");
      setStage("检查显示刷新率"); const hz = await measureDisplayRefreshRate(60); setRefresh(hz);
      if (control.signal.aborted) throw new Error(String(control.signal.reason));
      if (Math.abs(hz - 60) > 3) throw new Error(`当前刷新率 ${hz} Hz；本协议需要 60 Hz 显示设置`);
      await save({ ...runRef.current, sessions: [...new Set([...runRef.current.sessions, session.current!])] });
      if (baselineSession.current !== session.current) {
        const baselineId = crypto.randomUUID(); await marker({ markerType: "lab_baseline_start", trialId: baselineId, comparisonRunId: runRef.current.id, rendererPerformanceMs: performance.now() });
        await waitStage("睁眼静息 · 保持头部稳定", LAB_TIMING.baseline, control.signal);
        await marker({ markerType: "lab_baseline_end", trialId: baselineId, comparisonRunId: runRef.current.id, rendererPerformanceMs: performance.now() }); baselineSession.current = session.current;
      }
      for (const row of rows) {
        ready(); if (control.signal.aborted) throw new Error(String(control.signal.reason));
        setItem(row); setCount(row.count); setForm(row.appearance); frames.current = null; setEndTimestamp(undefined);
        await waitStage(row.kind === "static" ? `静态参考 · 注视 ${labCueLabel(row)} 中央点` : `准备 · 注视 ${labCueLabel(row)} 中央点`, LAB_TIMING.cue, control.signal);
        if (!geometry.current || geometry.current.targetCount !== row.count) throw new Error("刺激布局尚未就绪");
        const signature = JSON.stringify(geometry.current);
        const expected = runRef.current!.geometrySignatures?.[row.count];
        if (expected && signature !== expected) throw new Error("窗口或刺激尺寸与本实验之前的记录不同，请恢复原窗口尺寸后续测，或新建实验");
        const trialId = crypto.randomUUID();
        await save({ ...runRef.current!, geometrySignatures: { ...runRef.current!.geometrySignatures, [row.count]: signature }, attempts: [...runRef.current!.attempts, { trialId, itemId: row.id, sessionId: session.current!, startedAt: new Date().toISOString(), status: "started", attention: "pending" }] });
        if (control.signal.aborted) throw new Error(String(control.signal.reason));
        activeAttempt.current = { item: row, trialId };
        worker.current?.postMessage({ type: "configure", config: { sampleRateHz: deviceRef.current!.sample_rate_hz, channelCount: deviceRef.current!.channel_count, leadNames: deviceRef.current!.lead_names, targetFrequenciesHz: labTargets(row.count).map(t => t.frequencyHz), windowSeconds: 2.5, hopSeconds: .25, harmonics: 3, ...fbccaDecisionPolicy(row.count), maxTrialSeconds: 6, publishAnalysis: false, publishMatches: false } } satisfies WorkerInput);
        worker.current?.postMessage({ type: "start_trial", sessionId: session.current!, trialId } satisfies WorkerInput);
        const first = new Promise<number>(resolve => { firstResolve.current = resolve; });
        setStage(row.kind === "static" ? "静态参考 · 保持注视" : `刺激中 · 保持注视 ${labCueLabel(row)} 中央点`); setActive(true);
        const onset = await Promise.race([first, delay(3000, control.signal).then(() => { throw new Error("first_frame_timeout"); })]);
        await delay(Math.max(0, onset + LAB_TIMING.stimulus - performance.now()), control.signal);
        const ending = new Promise<StimulusFrameStats>(resolve => { if (frames.current) resolve(frames.current); else endResolve.current = resolve; });
        setActive(false); const stats = await Promise.race([ending, delay(1500, control.signal).then(() => { throw new Error("end_frame_timeout"); })]);
        if (control.signal.aborted) throw new Error(String(control.signal.reason));
        await writeEnd("lab_complete", stats); ready();
        await save({ ...runRef.current!, attempts: runRef.current!.attempts.map(a => a.trialId === trialId ? { ...a, status: "complete", stats } : a) });
        activeAttempt.current = null; worker.current?.postMessage({ type: "stop_trial" } satisfies WorkerInput);
        await waitStage("轮间休息 · 可正常眨眼", LAB_TIMING.rest, control.signal);
      }
      completeBatch = true; await save({ ...runRef.current!, breakUntil: Date.now() + LAB_TIMING.break }); setStage("本批完成 · 请确认注视情况并休息至少 60 秒");
    } catch (cause) {
      const reason = control.signal.aborted ? String(control.signal.reason) : String(cause); setError(reason); setStage("实验已暂停 · 未完成试次将使用新编号重做");
      setActive(false); await new Promise(resolve => setTimeout(resolve, 50));
      try { await writeEnd(reason, frames.current); } catch { setError(reason + "；结束标记未保存，此次无效"); }
      if (runRef.current) try { await save({ ...runRef.current, attempts: runRef.current.attempts.map(a => a.status === "started" ? { ...a, status: "invalid", reason, stats: frames.current ?? undefined } : a), breakUntil: Date.now() + LAB_TIMING.break }); } catch (saveError) { setError(reason + "；档案保存失败：" + String(saveError)); }
    } finally { worker.current?.postMessage({ type: "stop_trial" } satisfies WorkerInput); controller.current = null; activeAttempt.current = null; firstResolve.current = endResolve.current = null; setBusy(false); setActive(false); setDeadline(0); if (completeBatch) setBadTrials([]); }
  };
  const confirmAttention = () => operation(async () => { if (!runRef.current) return; await save({ ...runRef.current, attempts: runRef.current.attempts.map(a => a.status === "complete" && a.attention === "pending" ? { ...a, attention: badTrials.includes(a.trialId) ? "excluded" : "confirmed", reason: badTrials.includes(a.trialId) ? "attention_excluded" : a.reason, comfort } : a) }); setBadTrials([]); });
  const analyze = (final: boolean) => operation(async () => { if (!runRef.current) return; setStage(final ? "正在评估锁定测试集" : "正在分析开发集 · 测试集不会参与"); setAnalysis(await window.brainGameDesktop.labAnalyze(runRef.current.id, final)); setReportFinal(final); setStage("分析完成 · 可以打开报告"); });
  const next = run ? pendingItems(run)[0] : undefined, pendingAttention = run?.attempts.filter(a => a.status === "complete" && a.attention === "pending") ?? [];
  const targetCount = item?.count ?? count, appearance = item?.appearance ?? form;
  // Preserve the canvas effect and stimulus phase across HUD updates.
  const targets = useMemo(() => labTargets(targetCount), [targetCount]);
  const done = run ? completedItemIds(run) : new Set<string>(), breakSeconds = run ? Math.max(0, Math.ceil((run.breakUntil - now) / 1000)) : 0;
  const template = useMemo(() => labTemplate(targetCount), [targetCount]);
  return <main className="shell shell--lab stimulus-lab" data-target-count={targetCount} data-appearance={appearance}>
    <AppHeader title="刺激实验工作台" navigation={<strong className="lab-heading">刺激实验工作台</strong>} status={<span>{connected ? "设备已连接" : "设备未连接"} · {acquiring ? "采集中" : "未采集"}</span>} />
    <section className="lab-controls" aria-label="设备与记录">
      <button onClick={connect} disabled={busy || working || acquiring}>连接网关</button><button onClick={startAcquisition} disabled={!connected || acquiring || busy || working}>开始采集</button><button onClick={stopAcquisition} disabled={!acquiring || busy || working}>停止采集</button>
      <span>固定导联 {ANALYSIS_LEADS.join(" / ")} · {device ? `${device.sample_rate_hz} Hz · μV` : "等待设备信息"}</span>
      <button className="secondary" onClick={() => void window.brainGameDesktop.openSessionFolder()}>记录目录</button>
      <span className="lab-channel-state" aria-label="通道状态">{ANALYSIS_LEADS.map(lead => {
        const present=device?.lead_names.some(name=>name.trim().toUpperCase()===lead.toUpperCase());
        const fresh=acquiring && latest.current && performance.now()-latest.current.at<500;
        return <span key={lead} data-ready={Boolean(present && fresh)}>{lead} · {present ? fresh ? "数据正常" : "等待数据" : "未检出"}</span>;
      })}</span>
    </section>
    <section className="lab-controls" aria-label="实验设置">
      <button onClick={newRun} disabled={busy || working}>新建完整实验</button>
      <label>实验档案 <select value={run?.id ?? ""} onChange={e => void load(e.target.value)} disabled={busy || working}><option value="">选择已保存记录</option>{[...records, ...(run && !records.some(r => r.id === run.id) ? [{id:run.id,createdAt:run.createdAt,completed:0}] : [])].map(r => <option key={r.id} value={r.id}>{new Date(r.createdAt).toLocaleString()} · {r.id.slice(0,8)}</option>)}</select></label>
      <label>预览数量 <select value={count} disabled={busy || working} onChange={e => { setItem(null); setCount(Number(e.target.value) as TargetCount); }}><option value={2}>2 个</option><option value={4}>4 个</option><option value={6}>6 个</option></select></label>
      <label>预览形式 <select value={form} disabled={busy || working} onChange={e => { setItem(null); setForm(e.target.value as typeof form); }}>{FORMS.map(f => <option key={f} value={f}>{FORM_LABELS[f]}</option>)}</select></label>
    </section>
    <section className="lab-status" aria-live="polite"><strong>{stage}{deadline > now ? ` · ${Math.ceil((deadline-now)/1000)} 秒` : ""}</strong><span>{run ? `主动 ${run.items.filter(i => i.kind === "active" && done.has(i.id)).length}/216 · 静态 ${run.items.filter(i => i.kind === "static" && done.has(i.id)).length}/9` : "三种形式 · 2 / 4 / 6 目标"}</span></section>
    {error && <p className="lab-error" role="alert">{error}</p>}
    <section className="lab-table"><StimulusTable active={active} targets={targets} referenceX={template.referenceX} referenceY={template.referenceY} activeTargetIndex={null} targetAppearance={appearance} stimulusFootprint={appearance === "card" ? "seat" : "card"} showSolidFixationPoint fixationMode="fixed" showReference={false} compactCards={targetCount > 2} targetSize="standard" surface="standard" showFrequencyLabels refreshRateHz={refresh} modulationAmplitude={item?.kind === "static" ? 0 : .45} stimulusEndTimestamp={endTimestamp} selectedTargetIndex={busy && !active && item ? item.cue : null} onFirstFrame={onFirstFrame} onFrameStats={onFrames} onGeometryChange={g => { geometry.current = g; }} onResizeWhileActive={() => abort("stimulus_resized")} onTimingFault={() => abort("severe_timing_fault")} onTimingDisruption={(_warning, invalid) => { if (invalid) abort("timing_window_invalid"); }} /></section>
    <section className="lab-controls"><button onClick={() => void startBatch()} disabled={!run || !acquiring || busy || working || !next || breakSeconds > 0 || pendingAttention.length > 0}>开始下一批</button><button onClick={() => abort("user_paused")} disabled={!busy}>暂停 / 停止刺激</button><span>{next ? `下一批 ${next.batch + 1}/18 · ${next.count} 个目标${breakSeconds ? ` · 休息剩余 ${breakSeconds} 秒` : ""}` : run ? "全部计划项已完成" : "请新建或载入实验"}</span></section>
    {pendingAttention.length > 0 && !busy && <section className="lab-review"><h2>本批实际注视确认</h2><p>请勾选漏看、明显移动或不确定的试次；其余试次将在你确认后记为持续注视。被排除项会安排重做。</p><div className="lab-review-list">{pendingAttention.map(a => { const t = run!.items.find(i => i.id === a.itemId)!; return <label key={a.trialId}><input type="checkbox" checked={badTrials.includes(a.trialId)} onChange={e => setBadTrials(e.target.checked ? [...badTrials,a.trialId] : badTrials.filter(id => id !== a.trialId))} />{t.kind === "static" ? "静态" : `第 ${t.group} 组`} · {t.count} 目标 · {FORM_LABELS[t.appearance]} · 注视 {t.cue+1} 号 · {a.trialId.slice(0,8)}</label>; })}</div><label>不适程度（0 无不适，5 明显不适） <input type="number" min={0} max={5} value={comfort} onChange={e => setComfort(Math.max(0,Math.min(5,Number(e.target.value))))} /></label><button disabled={working} onClick={confirmAttention}>确认其余试次均持续注视</button></section>}
    <section className="lab-review"><h2>结果分析</h2><p>开发集：第 1–4 组；锁定测试集：第 5–6 组。分析期间请停止采集。首次最终评估会冻结训练配置，后续只能查看同一份结果。</p><div className="lab-controls"><button disabled={!run || acquiring || busy || working || pendingAttention.length > 0} onClick={() => void analyze(false)}>分析开发集</button><button disabled={!run || acquiring || busy || working || pendingAttention.length > 0} onClick={() => void analyze(true)}>最终锁定评估</button><button className="secondary" disabled={!run || !analysis || working} onClick={() => void operation(async () => { await window.brainGameDesktop.labOpenReport(run!.id, reportFinal); })}>打开分析报告</button></div>{working && <p>正在处理，请等待；不会启动刺激。</p>}{analysis !== null && <p>报告已生成，包含四种算法、频谱与前后窗口比较、排除记录和同步说明。</p>}</section>
  </main>;
}

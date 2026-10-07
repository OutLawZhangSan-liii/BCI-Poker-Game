import { ReusableSpectrum } from "../teaching/reusableSpectrum";
import { RealSpectrogram } from "./RealSpectrogram";
import { AnalysisSummary } from "./AnalysisSummary";
import { createPortal } from "react-dom";
import { drawFrequencyTicks, drawPlotAxes, plotBackground } from "./AnalysisPlotStyle";
import { EEG_SAMPLE_UNIT, EEG_PSD_UNIT } from "../bci/units";
import { Tooltip } from "./StatusBadge";
import { SignalViewer, useAnalysisSection, notifyTraining } from "./TrainingLayout";
import { useEffect, useMemo, useRef, useState, type ReactNode, type MutableRefObject } from "react";
import type { EegChunk } from "../bci/protocol";
import { observationFilterInfo, type ObservationSignalMode } from "../teaching/observationFilter";
import { computeRealEegSpectrum, RealEegAnalysisBuffer, REAL_EEG_MAX_BUFFER_SAMPLES, REAL_EEG_MAX_CHANNEL_COUNT, REAL_EEG_MAX_FFT_LENGTH, REAL_EEG_MAX_SAMPLE_RATE_HZ, REAL_EEG_WINDOW_SECONDS, resolveRealEegChannelIndex, type RealEegSnapshot, type RealEegTap } from "../teaching/realEegAnalysis";

interface DeviceProperties {
  sample_rate_hz: number;
  samples_per_packet: number;
  channel_count: number;
  lead_names: string[];
}

interface RealEegAnalysisPanelProps {
  actionsTarget?: HTMLDivElement | null;
  active?: boolean;
  visible?: boolean;
  activeSessionId: string | null;
  acquiring: boolean;
  properties: DeviceProperties | null;
  chunkTapRef: MutableRefObject<RealEegTap | null>;
  onGoToLab: () => void;
  testMode?: boolean;
  compact?: boolean;
}

const CHART_MARGIN = { left: 82, right: 18, top: 16, bottom: 48 };
const processingDescription = (snapshot: RealEegSnapshot) => snapshot.processing === "filtered" && snapshot.filterInfo
  ? `${snapshot.filterInfo.lowHz}～${Number(snapshot.filterInfo.highHz.toFixed(2))}Hz 带通${snapshot.notchEnabled ? " + 50Hz 陷波" : ""}`
  : "原始信号（未滤波）";

function setupCanvas(canvas: HTMLCanvasElement) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const nextWidth = Math.max(1, Math.floor(width * ratio)), nextHeight = Math.max(1, Math.floor(height * ratio));
  if (!canvas.closest(".shell--teaching-observe") || canvas.width !== nextWidth) canvas.width = nextWidth;
  if (!canvas.closest(".shell--teaching-observe") || canvas.height !== nextHeight) canvas.height = nextHeight;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  return { context, width, height };
}

function drawGrid(context: CanvasRenderingContext2D, width: number, height: number, yMin: number, yMax: number, yTicks: number[], xTicks: Array<{ value: number; label: string }>, xMax: number) {
  const plot = { left: CHART_MARGIN.left, right: Math.max(CHART_MARGIN.left + 1, width - CHART_MARGIN.right), top: CHART_MARGIN.top, bottom: Math.max(CHART_MARGIN.top + 1, height - CHART_MARGIN.bottom) };
  context.fillStyle = plotBackground(context); context.fillRect(0, 0, width, height);
  context.font = "12px Arial, Microsoft YaHei, sans-serif"; context.textBaseline = "middle";
  context.strokeStyle = "#e0e0e0"; context.lineWidth = 1; context.fillStyle = "#353535";
  yTicks.forEach((value) => {
    const y = plot.bottom - ((value - yMin) / Math.max(1e-12, yMax - yMin)) * (plot.bottom - plot.top);
    context.beginPath(); context.moveTo(plot.left, y); context.lineTo(plot.right, y); context.stroke();
    context.textAlign = "right"; context.fillText(value.toPrecision(Math.abs(value) < 1 ? 2 : 3), plot.left - 8, y);
  });
  xTicks.forEach(({ value, label }) => {
    const x = plot.left + (xMax > 0 ? value / xMax : 0) * (plot.right - plot.left);
    context.beginPath(); context.moveTo(x, plot.top); context.lineTo(x, plot.bottom); context.stroke();
    context.textAlign = value === 0 ? "left" : value === xMax ? "right" : "center";
    context.fillText(label, x, plot.bottom + 14);
  });
  return { ...plot, yLabelWidth: context.canvas.closest(".shell--teaching-observe") ? Math.max(60, plot.top + plot.bottom - 12) : undefined, yTickWidth: Math.max(...yTicks.map(value => context.measureText(value.toPrecision(Math.abs(value) < 1 ? 2 : 3)).width)) };
}

// Preserve extrema within each pixel bucket rather than dropping narrow peaks.
function drawLodSeries(context: CanvasRenderingContext2D, values: Float32Array | Float64Array, count: number, xStep: number, plot: ReturnType<typeof drawGrid>, yMin: number, yMax: number) {
  const step = Math.max(1, Math.floor(1 / Math.max(1e-12, xStep)));
  const yScale = (plot.bottom - plot.top) / (yMax - yMin);
  for (let start = 0; start < count; start += step) {
    const end = Math.min(count, start + step);
    let minimum = start, maximum = start;
    for (let index = start + 1; index < end; index++) { if (values[index] < values[minimum]) minimum = index; if (values[index] > values[maximum]) maximum = index; }
    const first = Math.min(minimum, maximum), second = Math.max(minimum, maximum);
    const x = plot.left + first * xStep, y = plot.bottom - (values[first] - yMin) * yScale;
    if (start === 0) context.moveTo(x, y); else context.lineTo(x, y);
    if (second !== first) context.lineTo(plot.left + second * xStep, plot.bottom - (values[second] - yMin) * yScale);
  }
}

function drawWaveform(canvas: HTMLCanvasElement, samples: Float32Array, sampleRateHz: number, startTime = 0) {
  const setup = setupCanvas(canvas); if (!setup) return;
  const { context, width, height } = setup;
  const maximum = samples.reduce((value, sample) => Math.max(value, Math.abs(sample)), 0);
  const limit = maximum > 0 ? Math.max(1e-12, maximum * 1.1) : 1;
  const endTime = samples.length > 1 ? (samples.length - 1) / sampleRateHz : 0;
  const xMax = Math.max(endTime, 1 / sampleRateHz);
  const plot = drawGrid(context, width, height, -limit, limit, [-limit, -limit / 2, 0, limit / 2, limit], [0, endTime / 2, endTime].map((value) => ({ value, label: (startTime + value).toFixed(2) })), xMax);
  drawPlotAxes(context, plot, width, height, "时间 (s)", `幅值 (${EEG_SAMPLE_UNIT})`);
  context.save(); context.beginPath(); context.rect(plot.left, plot.top, plot.right - plot.left, plot.bottom - plot.top); context.clip();
  context.strokeStyle = "#0072bd"; context.lineWidth = 1.5; context.beginPath();
  if (canvas.closest(".shell--teaching-observe")) drawLodSeries(context, samples, samples.length, (plot.right - plot.left) / (sampleRateHz * xMax), plot, -limit, limit);
  else samples.forEach((value, index) => {
    const x = plot.left + ((index / sampleRateHz) / xMax) * (plot.right - plot.left);
    const y = plot.bottom - ((value + limit) / (2 * limit)) * (plot.bottom - plot.top);
    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
  }); context.stroke(); context.restore();
}

function spectrumVisibleMaximum(spectrum: NonNullable<ReturnType<typeof computeRealEegSpectrum>>, sampleRateHz: number) {
  const visibleMaxHz = Math.min(sampleRateHz / 2, 64);
  const maxIndex = Math.min(spectrum.frequenciesHz.length - 1, Math.floor(visibleMaxHz / spectrum.frequencyBinHz));
  let maximum = 0;
  for (let index = 0; index <= maxIndex; index++) maximum = Math.max(maximum, spectrum.powerDensity[index]);
  return maximum;
}

function drawSpectrum(canvas: HTMLCanvasElement, spectrum: ReturnType<typeof computeRealEegSpectrum>, sampleRateHz: number) {
  const setup = setupCanvas(canvas); if (!setup) return;
  const { context, width, height } = setup;
  const visibleMaxHz = Math.min(sampleRateHz / 2, 64);
  const maxIndex = spectrum ? Math.min(spectrum.frequenciesHz.length - 1, Math.floor(visibleMaxHz / spectrum.frequencyBinHz)) : -1;
  const maximum = spectrum ? spectrumVisibleMaximum(spectrum, sampleRateHz) : 1;
  const limit = Math.max(1e-12, maximum * 1.1);
  const plot = drawGrid(context, width, height, 0, limit, [0, limit / 4, limit / 2, limit * .75, limit], [], visibleMaxHz);
  drawFrequencyTicks(context, plot, visibleMaxHz, "x");
  drawPlotAxes(context, plot, width, height, "频率 (Hz)", `功率谱密度 (${EEG_PSD_UNIT})`);
  context.save(); context.beginPath(); context.rect(plot.left, plot.top, plot.right - plot.left, plot.bottom - plot.top); context.clip();
  context.strokeStyle = "#0072bd"; context.lineWidth = 1.5; context.beginPath();
  if (spectrum && canvas.closest(".shell--teaching-observe")) drawLodSeries(context, spectrum.powerDensity, maxIndex + 1, spectrum.frequencyBinHz / visibleMaxHz * (plot.right - plot.left), plot, 0, limit);
  else for (let index = 0; spectrum && index <= maxIndex; index += 1) {
    const x = plot.left + (spectrum.frequenciesHz[index] / visibleMaxHz) * (plot.right - plot.left);
    const y = plot.bottom - (spectrum.powerDensity[index] / limit) * (plot.bottom - plot.top);
    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
  }
  context.stroke(); context.restore();
}

function Chart({ snapshot, spectrum, samples, spectralSnapshot = snapshot, singleChart = false, channelControl, streamKey = "" }: { spectralSnapshot?: RealEegSnapshot; streamKey?: string; singleChart?: boolean; channelControl?: ReactNode; snapshot: RealEegSnapshot; spectrum: ReturnType<typeof computeRealEegSpectrum>; samples: Float32Array }) {
  const waveformRef = useRef<HTMLCanvasElement | null>(null);
  const spectrumRef = useRef<HTMLCanvasElement | null>(null);
  const spectrogramRef = useRef<HTMLCanvasElement | null>(null);
  const historyRef = useRef<RealSpectrogram | null>(null);
  const frameRef = useRef<number | null>(null);
  const lastDrawnRef = useRef("");
  const dataRef = useRef({ snapshot, spectralSnapshot, spectrum, samples, streamKey });
  const performanceRef = useRef({ frames: 0, totalMs: 0, waveMs: 0, psdMs: 0, tfMs: 0, dropped: 0, loggedAt: 0 });
  const renderedRef = useRef<{ wave: RealEegSnapshot | null; spectrum: ReturnType<typeof computeRealEegSpectrum> | undefined; tfRevision: number }>({ wave: null, spectrum: undefined, tfRevision: -1 });
  const redraw = () => {
    const data = dataRef.current;
    const rendered = renderedRef.current, stats = performanceRef.current;
    let started = import.meta.env.DEV ? performance.now() : 0;
    if ((singleChart || rendered.wave !== data.snapshot) && waveformRef.current?.clientWidth && data.snapshot.sampleRateHz) {
      drawWaveform(waveformRef.current, data.samples, data.snapshot.sampleRateHz, !singleChart && data.snapshot.windowEndSampleExclusive !== null ? Number(data.snapshot.windowEndSampleExclusive - BigInt(data.samples.length)) / data.snapshot.sampleRateHz : 0);
      rendered.wave = data.snapshot;
    }
    if (import.meta.env.DEV) { stats.waveMs += performance.now() - started; started = performance.now(); }
    if ((singleChart || rendered.spectrum !== data.spectrum) && spectrumRef.current?.clientWidth && data.snapshot.sampleRateHz) {
      drawSpectrum(spectrumRef.current, data.spectrum, data.snapshot.sampleRateHz); rendered.spectrum = data.spectrum;
    }
    if (import.meta.env.DEV) { stats.psdMs += performance.now() - started; started = performance.now(); }
    if (!singleChart && spectrogramRef.current?.clientWidth) {
      historyRef.current ??= new RealSpectrogram();
      historyRef.current.update(data.spectralSnapshot, data.spectrum, data.streamKey);
      if (rendered.tfRevision !== historyRef.current.revision) {
        historyRef.current.draw(spectrogramRef.current); rendered.tfRevision = historyRef.current.revision;
      }
    }
    if (import.meta.env.DEV) stats.tfMs += performance.now() - started;
  };
  const schedule = (force = false) => {
    if (singleChart) { redraw(); return; }
    if (force) { lastDrawnRef.current = ""; renderedRef.current.wave = null; renderedRef.current.spectrum = undefined; renderedRef.current.tfRevision = -1; }
    // A pending RAF always reads the latest data: no queue of stale frames.
    if (frameRef.current !== null) { if (import.meta.env.DEV) performanceRef.current.dropped++; return; }
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      if (!waveformRef.current?.clientWidth || document.hidden) return;
      const data = dataRef.current;
      const key = `${data.streamKey}|${data.snapshot.windowEndSampleExclusive}|${data.samples.length}|${data.snapshot.state}|${data.snapshot.sampleRateHz}`;
      if (key === lastDrawnRef.current) return;
      const started = performance.now(); redraw(); lastDrawnRef.current = key;
      if (import.meta.env.DEV) {
        const elapsed = performance.now() - started, stats = performanceRef.current;
        stats.totalMs += elapsed; stats.frames++;
        if (elapsed > 100) console.debug("EEG plots SLOW", elapsed.toFixed(1), "ms");
        if (performance.now() - stats.loggedAt >= 2000) {
          console.debug("EEG plots", { TimePlot: stats.waveMs / stats.frames, PSD: stats.psdMs / stats.frames, Spectrogram: stats.tfMs / stats.frames, PaintTotal: stats.totalMs / stats.frames, DroppedRenderTicks: stats.dropped });
          stats.frames = 0; stats.totalMs = stats.waveMs = stats.psdMs = stats.tfMs = stats.dropped = 0; stats.loggedAt = performance.now();
        }
      }
    });
  };
  useEffect(() => { dataRef.current = { snapshot, spectralSnapshot, spectrum, samples, streamKey }; schedule(); }, [snapshot, spectralSnapshot, spectrum, samples, streamKey]);
  useEffect(() => {
    const onResize = () => schedule(true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onResize);
    for (const canvas of [waveformRef.current, spectrumRef.current, spectrogramRef.current]) if (canvas) observer?.observe(canvas);
    window.addEventListener("resize", onResize);
    const onVisibility = () => { if (!document.hidden) schedule(true); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { observer?.disconnect(); window.removeEventListener("resize", onResize); document.removeEventListener("visibilitychange", onVisibility); if (frameRef.current !== null) cancelAnimationFrame(frameRef.current); frameRef.current = null; };
  }, [singleChart]);
  const waveformMaximum = useMemo(() => samples.reduce((value, sample) => Math.max(value, Math.abs(sample)), 0), [samples]);
  const waveform = <article className="sim-analysis-chart-card real-chart-waveform"><div className="sim-analysis-chart-heading"><h4>时域波形</h4></div>
      <canvas ref={waveformRef} className="sim-analysis-chart" aria-label="实时网关 EEG 时域波形" />
      <details className="chart-explanation"><summary>图表说明</summary><small>{processingDescription(snapshot)} · 单位 {EEG_SAMPLE_UNIT}、未重参考 · 自动范围 ±{(waveformMaximum > 0 ? Math.max(1e-12, waveformMaximum * 1.1) : 1).toPrecision(3)} {EEG_SAMPLE_UNIT}</small></details>
    </article>;
  const spectrumChart = <article className="sim-analysis-chart-card real-chart-spectrum"><div className="sim-analysis-chart-heading"><h4>功率谱密度（PSD）</h4></div>
      <div className="real-eeg-chart-slot"><canvas ref={spectrumRef} className="sim-analysis-chart" aria-label="实时网关 EEG 功率谱密度" />{!spectrum && <div className="real-eeg-empty-chart">正在积累完整分析窗口</div>}</div>
      <details className="chart-explanation"><summary>图表说明</summary><small>{processingDescription(snapshot)}；与时域使用同一窗口，去均值、周期 Hann 窗 · 自动范围 0–{spectrum && snapshot.sampleRateHz ? Math.max(1e-12, spectrumVisibleMaximum(spectrum, snapshot.sampleRateHz) * 1.1).toPrecision(3) : "—"}</small></details>
    </article>;
  return singleChart ? <SignalViewer waveform={waveform} spectrum={spectrumChart} channelControl={channelControl} /> : <div className="sim-analysis-charts real-eeg-analysis-charts real-eeg-three-charts">
    <article className="sim-analysis-chart-card real-chart-spectrogram"><div className="sim-analysis-chart-heading"><h4>时频图（Spectrogram）</h4></div>
      <canvas ref={spectrogramRef} className="sim-analysis-chart" aria-label="实时 EEG 时频图，时间秒，频率赫兹，功率分贝" />
      <details className="chart-explanation"><summary>图表说明</summary><small>复用当前通道的窗口 PSD，显示最近约 30 秒；颜色为 10·log10(PSD / 1 {EEG_PSD_UNIT})，固定 −60～60 dB。谱列间保持最近可用窗口颜色；数据中断后重新积累。</small></details>
    </article>{waveform}{spectrumChart}</div>;
}

const statusText: Record<RealEegSnapshot["state"], string> = {
  waiting: "等待有效 EEG 数据", accumulating: "正在积累连续窗口", running: "运行中", paused: "已暂停，继续后重新积累", interrupted: "数据中断，等待恢复", invalid: "元数据或样本异常，已停止分析",
};

export function RealEegAnalysisPanel({ active = true, visible = active, activeSessionId, acquiring, properties, chunkTapRef, onGoToLab, compact = false, actionsTarget }: RealEegAnalysisPanelProps) {
  const sheetSection = useAnalysisSection();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [observing, setObserving] = useState(true);
  const [signalMode, setSignalMode] = useState<ObservationSignalMode>("filtered");
  const [notchEnabled, setNotchEnabled] = useState(false);
  const viewRef = useRef({ signalMode, notchEnabled }); viewRef.current = { signalMode, notchEnabled };
  const [analysisBuffer] = useState(() => new RealEegAnalysisBuffer());
  const streamRef = useRef(analysisBuffer);
  const readSnapshot = () => streamRef.current.snapshot(!compact, viewRef.current.signalMode, viewRef.current.notchEnabled);
  const [snapshot, setSnapshot] = useState<RealEegSnapshot>(readSnapshot);
  useEffect(() => { setSnapshot(readSnapshot()); }, [signalMode, notchEnabled]);
  const observingRef = useRef(observing); observingRef.current = observing;
  const activeSessionRef = useRef(activeSessionId); activeSessionRef.current = activeSessionId;
  const generationRef = useRef(0);
  const acceptingRef = useRef(false);
  const userPausedRef = useRef(false);
  const windowHiddenRef = useRef(typeof document !== "undefined" ? document.hidden : false);
  const [lifecycleEpoch, setLifecycleEpoch] = useState(0);
  const channelSelectionRef = useRef<{ initialized: boolean; signature: string; name: string | null }>({ initialized: false, signature: "", name: null });
  const rawNames = properties?.lead_names;
  const names = Array.isArray(rawNames) ? rawNames : [];
  const windowSamples = properties && Number.isFinite(properties.sample_rate_hz) ? Math.round(REAL_EEG_WINDOW_SECONDS * properties.sample_rate_hz) : 0;
  const estimatedFftLength = windowSamples > 0 ? 2 ** Math.ceil(Math.log2(windowSamples)) : 0;
  const metadataValid = !properties || (Number.isFinite(properties.sample_rate_hz) && properties.sample_rate_hz > 0 && properties.sample_rate_hz <= REAL_EEG_MAX_SAMPLE_RATE_HZ && Number.isInteger(properties.channel_count) && properties.channel_count > 0 && properties.channel_count <= REAL_EEG_MAX_CHANNEL_COUNT && Number.isInteger(properties.samples_per_packet) && properties.samples_per_packet >= 0 && properties.samples_per_packet <= REAL_EEG_MAX_BUFFER_SAMPLES && (!rawNames || Array.isArray(rawNames)) && windowSamples >= 2 && windowSamples <= REAL_EEG_MAX_BUFFER_SAMPLES && estimatedFftLength <= REAL_EEG_MAX_FFT_LENGTH);
  const metadataError = properties && !metadataValid ? "设备通道、采样率或每包样本元数据超出实时观察上限" : null;
  const namesSignature = metadataValid ? names.join("|") : "invalid";
  // Keep this allocation behind the bounds check so hostile channel_count
  // metadata cannot create an unbounded option list before validation.
  const normalizedNames = useMemo(() => metadataError ? [] : Array.from({ length: properties?.channel_count ?? 0 }, (_, index) => names[index]?.trim() || `通道 ${index + 1}（名称缺失）`), [properties?.channel_count, namesSignature, metadataError]);
  const metadataSignature = `${properties?.channel_count ?? 0}|${namesSignature}`;
  const preferredIndex = normalizedNames.findIndex((name) => name.toUpperCase() === "O1");
  useEffect(() => {
    generationRef.current += 1;
    acceptingRef.current = false;
    const selection = channelSelectionRef.current;
    const nextIndex = resolveRealEegChannelIndex(normalizedNames, selectedIndex, selection.name, selection.initialized);
    if (nextIndex !== selectedIndex) setSelectedIndex(nextIndex);
    selection.initialized = selection.initialized || normalizedNames.length > 0;
    selection.signature = metadataSignature;
    selection.name = normalizedNames[nextIndex] ?? null;
    if (!active || windowHiddenRef.current || !activeSessionId || !acquiring || !properties || metadataError) {
      if (metadataError) streamRef.current.invalidate("invalid", "设备通道或采样率元数据无效，已停止实时图表分析。");
      else streamRef.current.invalidate();
      setSnapshot(readSnapshot()); return;
    }
    try {
      streamRef.current.configure({ sessionId: activeSessionId, sampleRateHz: properties.sample_rate_hz, samplesPerPacket: properties.samples_per_packet, channelCount: properties.channel_count, channelIndex: nextIndex });
      if (!observingRef.current) streamRef.current.pause();
      else acceptingRef.current = true;
    } catch { streamRef.current.invalidate("invalid", "设备元数据无效，无法配置实时 EEG 观察。"); }
    setSnapshot(readSnapshot());
  }, [active, activeSessionId, acquiring, properties?.sample_rate_hz, properties?.samples_per_packet, properties?.channel_count, metadataSignature, selectedIndex, metadataError, normalizedNames.join("|"), lifecycleEpoch]);
  useEffect(() => {
    const generation = ++generationRef.current;
    acceptingRef.current = Boolean(active && !windowHiddenRef.current && activeSessionId && acquiring && observing && !userPausedRef.current && !metadataError);
    const tap: RealEegTap = {
      acceptChunk: (chunk: EegChunk) => { if (generation !== generationRef.current || !acceptingRef.current || windowHiddenRef.current || userPausedRef.current || !observingRef.current || !activeSessionRef.current || chunk.sessionId !== activeSessionRef.current) return; streamRef.current.acceptChunk(chunk, performance.now()); },
      invalidate: () => { if (generation === generationRef.current) { acceptingRef.current = false; generationRef.current += 1; streamRef.current.invalidate(); setSnapshot(readSnapshot()); } },
    };
    chunkTapRef.current = tap;
    return () => { if (chunkTapRef.current === tap) chunkTapRef.current = null; if (generation === generationRef.current) { acceptingRef.current = false; generationRef.current += 1; } };
  }, [chunkTapRef, active, activeSessionId, acquiring, observing, selectedIndex, properties?.sample_rate_hz, properties?.samples_per_packet, properties?.channel_count, metadataSignature, metadataError, lifecycleEpoch]);
  const publishedVersionRef = useRef(snapshot.version);
  useEffect(() => {
    if (!active || windowHiddenRef.current || !activeSessionId || !acquiring || !observing || userPausedRef.current) return;
    const timer = window.setInterval(() => {
      streamRef.current.checkTimeout(performance.now());
      if (streamRef.current.currentVersion !== publishedVersionRef.current) {
        const next = readSnapshot();
        publishedVersionRef.current = next.version;
        setSnapshot(next);
      }
    }, compact ? 100 : 50);
    return () => window.clearInterval(timer);
  }, [active, activeSessionId, acquiring, observing, lifecycleEpoch]);
  useEffect(() => {
    const onVisibility = () => {
      windowHiddenRef.current = document.hidden;
      acceptingRef.current = false;
      generationRef.current += 1;
      streamRef.current.invalidate();
      setSnapshot(readSnapshot());
      if (!document.hidden) setLifecycleEpoch((epoch) => epoch + 1);
    };
    document.addEventListener("visibilitychange", onVisibility); return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  const [spectrumCalculator] = useState(() => new ReusableSpectrum());
  const spectrumWorkspace = useRef(spectrumCalculator);
  const spectralRef = useRef<{ key: string; end: bigint | null; at: number; snapshot: RealEegSnapshot; spectrum: ReturnType<typeof computeRealEegSpectrum> } | null>(null);
  const spectralData = useMemo(() => {
    if (compact) return { snapshot, spectrum: computeRealEegSpectrum(snapshot) };
    const key = `${activeSessionId}|${selectedIndex}|${snapshot.sampleRateHz}|${snapshot.fftLength}|${snapshot.processing}|${snapshot.notchEnabled}`;
    const previous = spectralRef.current, end = snapshot.windowEndSampleExclusive;
    if (snapshot.state === "paused" && previous?.key === key) return previous;
    if (!snapshot.sampleRateHz || end === null || snapshot.sampleCount < snapshot.windowSamples) {
      spectralRef.current = null; return { snapshot, spectrum: null };
    }
    const now = performance.now(), hop = BigInt(Math.max(1, Math.ceil(snapshot.sampleRateHz / 5)));
    if (previous?.key === key && previous.end !== null && end >= previous.end && (end - previous.end < hop || now - previous.at < 200)) return previous;
    const spectrum = spectrumWorkspace.current.compute(snapshot.samples, snapshot.sampleRateHz, snapshot.fftLength);
    const result = { key, end, at: now, snapshot, spectrum };
    spectralRef.current = result; return result;
  }, [snapshot, activeSessionId, selectedIndex, compact]);
  const spectrum = spectralData.spectrum;
  // Publish all three plots from the same processed window. PSD is calculated
  // once at 5 Hz; the spectrogram continues to reuse that exact result.
  const displaySnapshot = spectrum ? spectralData.snapshot : snapshot;
  const visibleSamples = useMemo(() => displaySnapshot.sampleRateHz ? displaySnapshot.samples.subarray(-Math.min(displaySnapshot.sampleCount, displaySnapshot.windowSamples || displaySnapshot.sampleCount)) : new Float32Array(), [displaySnapshot]);
  const peak = spectrum ? spectrum.powerDensity.reduce((best, value, index) => value > spectrum.powerDensity[best] ? index : best, 0) : null;
  const noSession = !activeSessionId || !acquiring;
  const pauseOrResume = () => { if (observing) { userPausedRef.current = true; acceptingRef.current = false; generationRef.current += 1; streamRef.current.pause(); setObserving(false); } else { userPausedRef.current = false; streamRef.current.resume(); setObserving(true); } if (!compact && userPausedRef.current) setSnapshot(previous => ({ ...previous, state: "paused" })); else setSnapshot(readSnapshot()); };
  const onChannelChange = (value: number) => { if (value === selectedIndex) return; channelSelectionRef.current.initialized = true; channelSelectionRef.current.name = normalizedNames[value] ?? null; setSelectedIndex(value); };
  const noPreferredChannel = normalizedNames.length > 0 && preferredIndex < 0;
  const channelControl = <label className="real-eeg-channel-selector"><span>通道选择</span><select aria-label="观察通道" value={selectedIndex} onChange={(event) => onChannelChange(Number(event.target.value))} disabled={!normalizedNames.length}>{normalizedNames.map((name, index) => <option key={`${index}-${name}`} value={index}>{index} · {name}</option>)}</select></label>;
  const filterInfo = metadataError ? null : observationFilterInfo(properties?.sample_rate_hz ?? NaN);
  const filterControls = <div className="real-eeg-filter-controls">
    <div className="real-eeg-filter-switch" role="group" aria-label="观察信号处理">
      <button type="button" aria-pressed={signalMode === "raw"} disabled={!observing} onClick={() => setSignalMode("raw")}>原始</button>
      <button type="button" aria-pressed={signalMode === "filtered"} disabled={!observing || !filterInfo} onClick={() => setSignalMode("filtered")}>滤波</button>
    </div>
    <label className="real-eeg-notch-option" title={!filterInfo?.notchAvailable ? "50Hz 陷波需要采样率高于 100Hz" : "仅作用于观察图表"}>
      <input type="checkbox" aria-label="观察 50Hz 陷波" checked={notchEnabled} disabled={!observing || signalMode !== "filtered" || !filterInfo?.notchAvailable} onChange={event => setNotchEnabled(event.target.checked)} />50Hz 陷波
    </label>
  </div>;
  const observationControls = <div className="real-eeg-controls">{!compact && channelControl}
      {filterControls}
      <button type="button" className="secondary" onClick={() => { pauseOrResume(); notifyTraining(observing ? "观察已暂停" : "观察已恢复"); }} disabled={noSession}>{observing ? "暂停观察" : "继续观察"}</button>
      {noSession && <button type="button" onClick={onGoToLab}>前往设备与实验</button>}
    </div>;
  return <section className="real-eeg-analysis" aria-label="实时网关 EEG 观察" hidden={!visible}>
    {actionsTarget ? visible && createPortal(observationControls, actionsTarget) : observationControls}
    {compact && noSession && <div className="signal-viewer-toolbar">{channelControl}</div>}
    {metadataError && <p className="sim-analysis-hint is-warning" role="alert">{metadataError}；已停止实时图表分析。</p>}
    {noPreferredChannel && !metadataError && <p className="sim-analysis-hint" role="status" title="设备元数据未提供 O1，可从实际通道列表中选择其他通道。">未提供 O1 · 可选其他通道 ⓘ</p>}
    {noSession && !metadataError && <p className="sim-analysis-hint" role="status" title="请先在设备与实验中连接网关并开始采集；当前不会生成替代波形。">未开始采集 ⓘ</p>}
    {compact ? <Tooltip text={`窗口 ${snapshot.windowSamples || "—"} 点 · 频率栅格 ${snapshot.sampleRateHz && snapshot.fftLength ? (snapshot.sampleRateHz / snapshot.fftLength).toFixed(3) : "—"} Hz · ${statusText[snapshot.state]}`}><div className="analysis-meta-bar">{snapshot.sampleRateHz ?? properties?.sample_rate_hz ?? "—"} Hz · {REAL_EEG_WINDOW_SECONDS} s · FFT {snapshot.fftLength || "—"} · {snapshot.state === "running" ? "运行中" : snapshot.state === "paused" ? "已暂停" : snapshot.state === "invalid" ? "异常" : snapshot.state === "interrupted" ? "数据中断" : snapshot.state === "accumulating" ? "积累窗口" : "等待数据"}</div></Tooltip> : <details className="analysis-collapsible"><summary>分析参数</summary><div className="sim-analysis-config"><span>Fs {snapshot.sampleRateHz ?? properties?.sample_rate_hz ?? "—"} Hz</span><span>窗口 {snapshot.windowSamples || "—"} 点（约 {REAL_EEG_WINDOW_SECONDS} s）</span><span>FFT {snapshot.fftLength || "—"} 点</span><span>频率栅格 {snapshot.sampleRateHz && snapshot.fftLength ? (snapshot.sampleRateHz / snapshot.fftLength).toFixed(3) : "—"} Hz</span><span>状态：{statusText[snapshot.state]}</span></div></details>}
    {!compact && <div className="real-eeg-analysis-status"><div className="analysis-meta-bar">{snapshot.sampleRateHz ?? properties?.sample_rate_hz ?? "—"} Hz · {REAL_EEG_WINDOW_SECONDS} s · FFT {snapshot.fftLength || "—"} · {statusText[snapshot.state]} · {processingDescription(snapshot)}</div><AnalysisSummary samples={visibleSamples} spectrum={spectrum} /></div>}
    {!noSession && !metadataError && <Chart streamKey={`${activeSessionId}|${selectedIndex}|${snapshot.sampleRateHz}|${snapshot.processing}|${snapshot.notchEnabled}`} snapshot={displaySnapshot} spectrum={spectrum} samples={visibleSamples} singleChart={compact} spectralSnapshot={spectralData.snapshot} channelControl={channelControl} />}
    <details className="analysis-runtime-details" open={compact ? sheetSection === "parameters" || undefined : undefined}><summary>参数与运行说明</summary>
    <div className="sim-analysis-footer"><span>窗口样本：{Math.min(snapshot.sampleCount, snapshot.windowSamples || snapshot.sampleCount)}/{snapshot.windowSamples || "—"}</span><span>样本序号：{snapshot.windowStartSample === null ? "—" : `${snapshot.windowStartSample.toString()}–${(snapshot.windowEndSampleExclusive! - 1n).toString()}`}</span><span>有效数据块：{snapshot.sampleCount ? "已接收" : "—"}</span>{peak === null || !spectrum ? <span>峰值：窗口未满</span> : <span>计算峰值：{spectrum.frequenciesHz[peak].toFixed(3)} Hz · {spectrum.powerDensity[peak].toPrecision(5)} {EEG_PSD_UNIT}</span>}</div>
    {!noSession && !metadataError && <p className={`sim-analysis-hint ${snapshot.notice ? "is-warning" : ""}`} role="status">{snapshot.notice ?? statusText[snapshot.state]}</p>}
    {!noSession && !metadataError && snapshot.historyNotice && snapshot.historyNotice !== snapshot.notice && <p className="sim-analysis-hint is-warning" role="note">历史告警：{snapshot.historyNotice}</p>}
    <p className="sim-analysis-preset-note">当前观察：{processingDescription(snapshot)}。三张图使用同一通道、同一处理窗口；PSD 去均值并加周期 Hann 窗，时频图复用 PSD。滤波为连续因果滤波，开始或恢复时可能有短暂过渡；未重参考、幅值单位为 {EEG_SAMPLE_UNIT}，PSD 单位为 {EEG_PSD_UNIT}。观察设置不影响原始数据保存或游戏识别。暂停时保留当前画面，继续后重新积累。</p>
    </details>
  </section>;
}

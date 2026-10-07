import { setupCanvas, drawGrid, clipToPlot, drawSpectrum, SpectrumFrequencyLegend } from "./SpectrumFigure";
import { ReusableSpectrum } from "../teaching/reusableSpectrum";
import { createPortal } from "react-dom";
import { drawFrequencyTicks, drawPlotAxes, plotBackground } from "./AnalysisPlotStyle";
import { Tooltip } from "./StatusBadge";
import { SignalViewer, useAnalysisSection, notifyTraining } from "./TrainingLayout";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  generateSimulatedSignalBlock,
  getSimulatedPreset,
  nextSimulatedNoiseSeed,
  noiseTeachingScenarioById,
  SIMULATED_FFT_LENGTH,
  SIMULATED_FREQUENCY_BIN_HZ,
  SIMULATED_SAMPLE_RATE_HZ,
  SIMULATED_WINDOW_SAMPLES,
  SIMULATED_PRESETS,
  DEFAULT_SIMULATED_NOISE_SEED,
  type NoiseTeachingScenarioId,
  type PowerSpectrum,
  type SimulatedPreset,
} from "../teaching/simulatedAnalysis";
import { appendTimeFrequencyHistory, computeKnownComponentSnr, createTimeFrequencyHistory, generateTemporalSignalBlock, stage8ScenarioById, type TemporalSignalMode, type TimeFrequencyColumn, type TimeFrequencyHistory, type Stage8SimulationScenario } from "../teaching/simulatedAdvanced";
import {
  createSimulatedClock,
  effectiveSimulatedSeconds,
  getSimulatedAnalysisHint,
  getSimulatedAnalysisStatus,
  pauseSimulatedClock,
  recoverSimulatedAnalysisState,
  resetSimulatedClock,
  samplesDueForClock,
  startSimulatedClock,
  type SimulatedClockState,
} from "../teaching/simulatedClock";

const REFRESH_INTERVAL_MS = 100;
const MAX_CATCH_UP_SAMPLES = SIMULATED_SAMPLE_RATE_HZ;
const MAX_BUFFERED_SAMPLES = SIMULATED_SAMPLE_RATE_HZ * 30 + SIMULATED_WINDOW_SAMPLES;


export interface SimulationScenarioRequest {
  id: NoiseTeachingScenarioId | Stage8SimulationScenario["id"];
  requestId: number;
}

function drawSeries(context: CanvasRenderingContext2D, values: Float32Array, plot: ReturnType<typeof drawGrid>, xMax: number, yLimit: number, color: string, dashed = false) {
  if (!values.length) return;
  context.strokeStyle = color;
  context.lineWidth = dashed ? 1.2 : 1.6;
  context.setLineDash(dashed ? [5, 4] : []);
  context.beginPath();
  values.forEach((value, index) => {
    const x = plot.left + ((index / SIMULATED_SAMPLE_RATE_HZ) / xMax) * (plot.right - plot.left);
    const y = plot.bottom - ((value + yLimit) / (2 * yLimit)) * (plot.bottom - plot.top);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
  context.setLineDash([]);
}

function drawWaveform(canvas: HTMLCanvasElement, observed: Float32Array, clean: Float32Array, showIdeal: boolean, yLimit: number) {
  const setup = setupCanvas(canvas);
  if (!setup) return;
  const { context, width, height } = setup;
  const endTime = observed.length > 1 ? (observed.length - 1) / SIMULATED_SAMPLE_RATE_HZ : 0;
  const xMax = endTime || 1;
  const xTicks = observed.length > 1
    ? [{ value: 0, label: "0.00" }, { value: endTime / 2, label: (endTime / 2).toFixed(2) }, { value: endTime, label: endTime.toFixed(2) }]
    : [{ value: 0, label: "0.00" }];
  const plot = drawGrid(context, width, height, -yLimit, yLimit, [-yLimit, -yLimit / 2, 0, yLimit / 2, yLimit], xTicks, xMax);
  drawPlotAxes(context, plot, width, height, "时间 (s)", "幅值 (a.u.)");
  clipToPlot(context, plot);
  drawSeries(context, observed, plot, xMax, yLimit, "#0072bd");
  if (showIdeal) drawSeries(context, clean, plot, xMax, yLimit, "#d95319", true);
  context.restore();
}

function AnalysisCanvas({ observed, clean, observedSpectrum, cleanSpectrum, showIdeal, waveformLimit, spectrumLimit, singleChart = false, spectrumOnly = false, targetFrequencies }: {
  observed: Float32Array;
  clean: Float32Array;
  observedSpectrum: PowerSpectrum | null;
  cleanSpectrum: PowerSpectrum | null;
  showIdeal: boolean;
  waveformLimit: number;
  spectrumLimit: number;
  singleChart?: boolean;
  spectrumOnly?: boolean;
  targetFrequencies?: number[];
}) {
  const waveformRef = useRef<HTMLCanvasElement | null>(null);
  const spectrumRef = useRef<HTMLCanvasElement | null>(null);
  const dataRef = useRef({ observed, clean, observedSpectrum, cleanSpectrum, showIdeal, waveformLimit, spectrumLimit, targetFrequencies });
  const frameRef = useRef<number | null>(null);
  const drawnRef = useRef<typeof dataRef.current | null>(null);
  const redraw = () => {
    const data = dataRef.current;
    if (data === drawnRef.current || document.hidden) return;
    drawnRef.current = data;
    if (waveformRef.current && waveformRef.current.clientWidth > 0) drawWaveform(waveformRef.current, data.observed, data.clean, data.showIdeal, data.waveformLimit);
    if (spectrumRef.current && spectrumRef.current.clientWidth > 0) drawSpectrum(spectrumRef.current, data.observedSpectrum, data.cleanSpectrum, data.showIdeal, data.spectrumLimit, data.targetFrequencies);
  };
  const schedule = (force = false) => {
    if (force) drawnRef.current = null;
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => { frameRef.current = null; redraw(); });
  };
  useEffect(() => {
    dataRef.current = { observed, clean, observedSpectrum, cleanSpectrum, showIdeal, waveformLimit, spectrumLimit, targetFrequencies };
    schedule();
  }, [observed, clean, observedSpectrum, cleanSpectrum, showIdeal, waveformLimit, spectrumLimit, targetFrequencies]);
  useEffect(() => {
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => schedule(true));
    if (waveformRef.current?.parentElement) observer?.observe(waveformRef.current.parentElement);
    if (spectrumRef.current?.parentElement) observer?.observe(spectrumRef.current.parentElement);
    const onResize = () => schedule(true);
    window.addEventListener("resize", onResize);
    let resolutionQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    const onResolutionChange = () => {
      resolutionQuery.removeEventListener("change", onResolutionChange);
      resolutionQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      resolutionQuery.addEventListener("change", onResolutionChange);
      schedule(true);
    };
    resolutionQuery.addEventListener("change", onResolutionChange);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", onResize);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current); frameRef.current = null;
      resolutionQuery.removeEventListener("change", onResolutionChange);
    };
  }, [singleChart]);
  const waveform = <article className="sim-analysis-chart-card">
      <div className="sim-analysis-chart-heading"><h4>时域波形</h4></div>
      <div className="sim-analysis-legend"><span className="sim-analysis-legend__observed">加噪信号</span>{showIdeal && <span className="sim-analysis-legend__clean">理想信号参考</span>}</div>
      <canvas ref={waveformRef} className="sim-analysis-chart" aria-label="加噪模拟信号时域波形" />
      <details className="chart-explanation"><summary>图表说明</summary><small>显示范围固定为 ±{waveformLimit}，超出范围的原始样本未修改。</small></details>
    </article>;
  const spectrumChart = <article className="sim-analysis-chart-card">
      <div className="sim-analysis-chart-heading"><h4>功率谱密度（PSD）</h4></div>
      <div className="sim-analysis-legend"><span className="sim-analysis-legend__observed">加噪信号计算结果</span>{showIdeal && <span className="sim-analysis-legend__clean">理想信号参考 PSD</span>}</div>
      <SpectrumFrequencyLegend frequencies={targetFrequencies ?? []} />
      <canvas ref={spectrumRef} className="sim-analysis-chart" aria-label="加噪模拟信号功率谱密度" />
      <details className="chart-explanation"><summary>图表说明</summary><small>显示范围固定为 0–{spectrumLimit}；理想参考与加噪信号使用同一窗口。</small></details>
    </article>;
  if (spectrumOnly) return spectrumChart;
  return singleChart ? <SignalViewer waveform={waveform} spectrum={spectrumChart} /> : <div className="sim-analysis-charts">{waveform}{spectrumChart}</div>;
}

const TIME_FREQUENCY_STEP_SAMPLES = 64;
const TIME_FREQUENCY_MAX_HISTORY_SECONDS = 30;
const TIME_FREQUENCY_COLOR_MIN = 1e-6;
const TIME_FREQUENCY_COLOR_MAX = 4;

function spectrogramColor(value: number) {
  const ratio = Math.max(0, Math.min(1, (Math.log10(Math.max(value, TIME_FREQUENCY_COLOR_MIN)) - Math.log10(TIME_FREQUENCY_COLOR_MIN)) / (Math.log10(TIME_FREQUENCY_COLOR_MAX) - Math.log10(TIME_FREQUENCY_COLOR_MIN))));
  const hue = 235 - ratio * 210;
  return `hsl(${hue.toFixed(0)} 78% ${(24 + ratio * 48).toFixed(0)}%)`;
}

function drawTimeFrequency(canvas: HTMLCanvasElement, columns: TimeFrequencyColumn[], windowSamples: number) {
  const setup = setupCanvas(canvas);
  if (!setup) return;
  const { context, width, height } = setup;
  const plot = { left: 82, right: Math.max(84, width - 88), top: 30, bottom: Math.max(32, height - 48) };
  context.fillStyle = plotBackground(context); context.fillRect(0, 0, width, height);
  context.font = "12px Arial, Microsoft YaHei, sans-serif"; context.textBaseline = "middle"; context.fillStyle = "#353535";
  const maxHz = 64;
  const startTime = columns[0]?.centerTimeSeconds ?? 0;
  const endTime = columns.at(-1)?.centerTimeSeconds ?? Math.max(1, windowSamples / 256);
  const timeSpan = Math.max(1 / 256, endTime - startTime);
  const xFor = (time: number) => plot.left + ((time - startTime) / timeSpan) * (plot.right - plot.left);
  const yFor = (frequency: number) => plot.bottom - (frequency / maxHz) * (plot.bottom - plot.top);
  if (columns.length) {
    columns.forEach((column, columnIndex) => {
      const x0 = columnIndex === 0 ? plot.left : xFor((columns[columnIndex - 1].centerTimeSeconds + column.centerTimeSeconds) / 2);
      const x1 = columnIndex === columns.length - 1 ? plot.right : xFor((column.centerTimeSeconds + columns[columnIndex + 1].centerTimeSeconds) / 2);
      const maxIndex = Math.min(column.spectrum.frequenciesHz.length - 1, Math.floor(maxHz / column.spectrum.frequencyBinHz));
      for (let index = 0; index <= maxIndex; index += 1) {
        const frequency = column.spectrum.frequenciesHz[index];
        const y0 = yFor(frequency + column.spectrum.frequencyBinHz);
        const y1 = yFor(frequency);
        context.fillStyle = spectrogramColor(column.spectrum.powerDensity[index]);
        context.fillRect(x0, y0, Math.max(1, x1 - x0 + 0.5), Math.max(1, y1 - y0 + 0.5));
      }
    });
  } else {
    context.fillStyle = "#353535"; context.textAlign = "center"; context.fillText("正在积累完整时频窗口", (plot.left + plot.right) / 2, (plot.top + plot.bottom) / 2);
  }
  context.strokeStyle = "rgba(80,80,80,.25)"; context.lineWidth = 1;
  drawFrequencyTicks(context, plot, maxHz, "y", "rgba(80,80,80,.25)");
  const timeTicks = columns.length > 1 ? [startTime, (startTime + endTime) / 2, endTime] : [startTime];
  timeTicks.forEach((time) => { const x = columns.length > 1 ? xFor(time) : plot.left; context.beginPath(); context.moveTo(x, plot.top); context.lineTo(x, plot.bottom); context.stroke(); context.textAlign = time === endTime ? "right" : "center"; context.fillText(time.toFixed(1), x, plot.bottom + 14); });
  const legendX = Math.max(plot.right + 8, width - 76); const legendTop = plot.top; const legendHeight = plot.bottom - plot.top;
  for (let index = 0; index < legendHeight; index += 1) { context.fillStyle = spectrogramColor(10 ** (Math.log10(TIME_FREQUENCY_COLOR_MAX) - index / Math.max(1, legendHeight - 1) * (Math.log10(TIME_FREQUENCY_COLOR_MAX) - Math.log10(TIME_FREQUENCY_COLOR_MIN)))); context.fillRect(legendX, legendTop + index, 10, 1); }
  context.fillStyle = "#353535"; context.textAlign = "left"; context.font = "11px Arial, Microsoft YaHei, sans-serif"; context.fillText("PSD (a.u.²/Hz)", plot.right - 4, legendTop - 14); context.fillText("4", legendX + 14, legendTop); context.fillText("1e−6", legendX + 14, plot.bottom);
  drawPlotAxes(context, plot, width, height, "时间 (s)", "频率 (Hz)");
}

function TimeFrequencyCanvas({ columns, windowSamples }: { columns: TimeFrequencyColumn[]; windowSamples: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dataRef = useRef({ columns, windowSamples });
  const redraw = () => { if (canvasRef.current) drawTimeFrequency(canvasRef.current, dataRef.current.columns, dataRef.current.windowSamples); };
  useEffect(() => { dataRef.current = { columns, windowSamples }; redraw(); }, [columns, windowSamples]);
  useEffect(() => {
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(redraw);
    if (canvasRef.current?.parentElement) observer?.observe(canvasRef.current.parentElement);
    window.addEventListener("resize", redraw);
    return () => { observer?.disconnect(); window.removeEventListener("resize", redraw); };
  }, []);
  return <article className="sim-analysis-chart-card sim-analysis-time-frequency-card"><div className="sim-analysis-chart-heading"><h4>模拟时频图</h4></div><canvas ref={canvasRef} className="sim-analysis-chart sim-analysis-time-frequency" aria-label="模拟数据时频图" /><small>颜色采用 PSD 的对数映射，范围 1e−6～4 a.u.²/Hz。</small></article>;
}

function appendBlock(previous: Float32Array, next: Float32Array, capacity = MAX_BUFFERED_SAMPLES) {
  const combined = new Float32Array(Math.min(capacity, previous.length + next.length));
  const previousStart = Math.max(0, previous.length - (combined.length - next.length));
  if (combined.length > next.length) combined.set(previous.subarray(previousStart), 0);
  combined.set(next, combined.length - next.length);
  return combined;
}

const maxAbsolute = (values: Float32Array) => values.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
const maxSpectrum = (spectrum: PowerSpectrum | null) => spectrum ? Math.max(...spectrum.powerDensity) : 0;

export function SimulatedAnalysisPanel({ principleDemo = false, demoFrequencies = [], demoCandidates = demoFrequencies, demoLabels = [], demoRunning = false, scenarioRequest, active = true, visible = active, compact = false, presentation = "full", actionsTarget }: { principleDemo?: boolean; demoFrequencies?: number[]; demoCandidates?: number[]; demoLabels?: string[]; demoRunning?: boolean; actionsTarget?: HTMLDivElement | null; scenarioRequest?: SimulationScenarioRequest | null; active?: boolean; visible?: boolean; compact?: boolean; presentation?: "full" | "sidebar" }) {
  const [configurationOpen, setConfigurationOpen] = useState(true);
  const [explanationOpen, setExplanationOpen] = useState(false);
  const [presetId, setPresetId] = useState<SimulatedPreset["id"]>("single12");
  const [amplitudeScale, setAmplitudeScale] = useState(1);
  const [amplitudeInput, setAmplitudeInput] = useState("1");
  const [noiseSigma, setNoiseSigma] = useState(0);
  const [noiseInput, setNoiseInput] = useState("0");
  const [noiseSeed, setNoiseSeed] = useState(DEFAULT_SIMULATED_NOISE_SEED);
  const [showIdeal, setShowIdeal] = useState(false);
  const [waveformLimit, setWaveformLimit] = useState(4);
  const [spectrumView, setSpectrumView] = useState<"full" | "background" | "expanded">("full");
  const [analysisView, setAnalysisView] = useState<"charts" | "time-frequency">("charts");
  const [timeFrequencyWindow, setTimeFrequencyWindow] = useState<256 | 512>(512);
  const [timeFrequencyStartSample, setTimeFrequencyStartSample] = useState(0);
  const [timeFrequencyNotice, setTimeFrequencyNotice] = useState<string | null>(null);
  const [temporalMode, setTemporalMode] = useState<TemporalSignalMode>("static");
  const [amplitudeError, setAmplitudeError] = useState<string | null>(null);
  const [noiseError, setNoiseError] = useState<string | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [observedSamples, setObservedSamples] = useState<Float32Array>(new Float32Array());
  const [cleanSamples, setCleanSamples] = useState<Float32Array>(new Float32Array());
  const [noiseSamples, setNoiseSamples] = useState<Float32Array>(new Float32Array());
  const [clockSeconds, setClockSeconds] = useState(0);
  const cursorRef = useRef(0);
  const observedRef = useRef(observedSamples);
  const cleanRef = useRef(cleanSamples);
  const noiseRef = useRef(noiseSamples);
  const timeFrequencyHistoryRef = useRef<TimeFrequencyHistory>(createTimeFrequencyHistory());
  const [timeFrequencyColumns, setTimeFrequencyColumns] = useState<TimeFrequencyColumn[]>([]);
  const clockRef = useRef<SimulatedClockState>(createSimulatedClock());
  const demoFrequencyKey = demoFrequencies.join("|");
  const preset = useMemo(() => principleDemo ? { ...getSimulatedPreset("dual"), label: demoFrequencies.map(frequency => `${frequency} Hz`).join(" ＋ "), components: demoFrequencies.map(frequencyHz => ({ frequencyHz, amplitude: demoFrequencies.length > 1 ? 0.7 : 1 })) } : getSimulatedPreset(presetId), [principleDemo, demoFrequencyKey, presetId]);
  const spectrumLimit = spectrumView === "background" ? 0.12 : spectrumView === "expanded" ? 4 : 3;
  const observedWindow = useMemo(() => observedSamples.length > SIMULATED_WINDOW_SAMPLES ? observedSamples.subarray(-SIMULATED_WINDOW_SAMPLES) : observedSamples, [observedSamples]);
  const cleanWindow = useMemo(() => cleanSamples.length > SIMULATED_WINDOW_SAMPLES ? cleanSamples.subarray(-SIMULATED_WINDOW_SAMPLES) : cleanSamples, [cleanSamples]);
  const noiseWindow = useMemo(() => noiseSamples.length > SIMULATED_WINDOW_SAMPLES ? noiseSamples.subarray(-SIMULATED_WINDOW_SAMPLES) : noiseSamples, [noiseSamples]);
  const [observedCalculator] = useState(() => new ReusableSpectrum()), [cleanCalculator] = useState(() => new ReusableSpectrum());
  const observedWorkspace = useRef(observedCalculator), cleanWorkspace = useRef(cleanCalculator);
  const observedSpectrum = useMemo(() => observedWindow.length === SIMULATED_WINDOW_SAMPLES ? observedWorkspace.current.compute(observedWindow, SIMULATED_SAMPLE_RATE_HZ, SIMULATED_FFT_LENGTH) : null, [observedWindow]);
  const cleanSpectrum = useMemo(() => showIdeal && cleanWindow.length === SIMULATED_WINDOW_SAMPLES ? cleanWorkspace.current.compute(cleanWindow, SIMULATED_SAMPLE_RATE_HZ, SIMULATED_FFT_LENGTH) : null, [cleanWindow, showIdeal]);
  const snr = useMemo(() => observedWindow.length >= SIMULATED_WINDOW_SAMPLES ? computeKnownComponentSnr(cleanWindow, noiseWindow) : { signalPower: 0, noisePower: 0, snrDb: null, state: "incomplete" as const }, [cleanWindow, noiseWindow, observedWindow.length]);
  const timeFrequencyOverflow = timeFrequencyColumns.some((column) => maxSpectrum(column.spectrum) > TIME_FREQUENCY_COLOR_MAX);
  const sheetSection = useAnalysisSection();
  const isSidebar = presentation === "sidebar";
  const windowStart = Math.max(0, cursorRef.current - observedWindow.length);
  const windowEnd = observedWindow.length ? windowStart + observedWindow.length - 1 : null;
  const observedPeak = observedSpectrum ? observedSpectrum.powerDensity.reduce((best, value, index) => value > observedSpectrum.powerDensity[best] ? index : best, 0) : null;
  const peakText = observedPeak === null ? "暂无（窗口未满）" : `${observedSpectrum?.frequenciesHz[observedPeak].toFixed(1)} Hz · ${observedSpectrum?.powerDensity[observedPeak].toFixed(4)} 相对幅值²/Hz`;
  const waveformOverflow = Math.max(maxAbsolute(observedWindow), showIdeal ? maxAbsolute(cleanWindow) : 0) > waveformLimit;
  const spectrumOverflow = Math.max(maxSpectrum(observedSpectrum), showIdeal ? maxSpectrum(cleanSpectrum) : 0) > spectrumLimit;
  const advanceClock = () => {
    const seconds = pauseSimulatedClock(clockRef.current, performance.now());
    setClockSeconds(seconds);
  };
  const resetTimeFrequencyHistory = (sampleStart = 0) => {
    timeFrequencyHistoryRef.current = createTimeFrequencyHistory(sampleStart);
    setTimeFrequencyColumns([]);
  };
  const resetBuffers = (nextRunning = clockRef.current.startedAtMs !== null) => {
    cursorRef.current = 0;
    observedRef.current = new Float32Array();
    cleanRef.current = new Float32Array();
    noiseRef.current = new Float32Array();
    resetSimulatedClock(clockRef.current, performance.now(), nextRunning);
    setRecoveryNotice(null);
    setClockSeconds(0);
    setObservedSamples(observedRef.current);
    setCleanSamples(cleanRef.current);
    setNoiseSamples(noiseRef.current);
    setTimeFrequencyStartSample(0);
    setTimeFrequencyNotice(null);
    resetTimeFrequencyHistory(0);
  };
  useEffect(() => {
    if (!principleDemo) return;
    if (demoRunning) { resetBuffers(true); setRunning(true); }
    else { advanceClock(); setRunning(false); }
  }, [principleDemo, demoRunning, demoFrequencyKey]);
  const changePreset = (next: SimulatedPreset["id"]) => {
    setPresetId(next);
    setTemporalMode("static");
    resetBuffers();
  };
  const handleAmplitudeInput = (raw: string) => {
    setAmplitudeInput(raw);
    if (raw.trim() === "") {
      setAmplitudeError("请输入 0.1–2.0 之间的有限数值");
      return;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0.1 || value > 2) {
      setAmplitudeError("信号幅值必须是 0.1–2.0 之间的有限数值");
      return;
    }
    setAmplitudeError(null);
    setAmplitudeScale(value);
    resetBuffers();
  };
  const handleNoiseInput = (raw: string) => {
    setNoiseInput(raw);
    if (raw.trim() === "") {
      setNoiseError("请输入 0–1 之间的有限噪声强度");
      return;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      setNoiseError("噪声强度 σ 必须是 0–1 之间的有限数值");
      return;
    }
    setNoiseError(null);
    setNoiseSigma(value);
    resetBuffers();
  };
  const changeNoiseSeed = () => {
    setNoiseSeed((seed) => nextSimulatedNoiseSeed(seed));
    resetBuffers();
  };
  const startAnalysis = () => {
    startSimulatedClock(clockRef.current, performance.now());
    setRunning(true);
  };
  const pauseAnalysis = () => {
    advanceClock();
    setRunning(false);
  };
  const changeTimeFrequencyWindow = (value: 256 | 512) => {
    if (value === timeFrequencyWindow) return;
    setTimeFrequencyWindow(value);
    setTimeFrequencyStartSample(cursorRef.current);
    resetTimeFrequencyHistory(cursorRef.current);
    setTimeFrequencyNotice(`时频窗口已切换为 ${value} 点；历史列已清空，请继续运行以重新积累。`);
  };
  useEffect(() => {
    if (!scenarioRequest) return;
    const advancedScenario = stage8ScenarioById(scenarioRequest.id as Stage8SimulationScenario["id"]);
    const amplitude = advancedScenario?.amplitudeScale ?? noiseTeachingScenarioById(scenarioRequest.id as NoiseTeachingScenarioId).amplitudeScale;
    const sigma = advancedScenario?.noiseSigma ?? noiseTeachingScenarioById(scenarioRequest.id as NoiseTeachingScenarioId).noiseSigma;
    const presetForScenario = advancedScenario ? "single12" : noiseTeachingScenarioById(scenarioRequest.id as NoiseTeachingScenarioId).presetId;
    setPresetId(presetForScenario);
    setTemporalMode(principleDemo ? "static" : advancedScenario?.temporalMode ?? "static");
    setAmplitudeScale(amplitude);
    setAmplitudeInput(String(amplitude));
    setNoiseSigma(sigma);
    setNoiseInput(String(sigma));
    setAmplitudeError(null);
    setNoiseError(null);
    setRunning(false);
    resetBuffers(false);
  }, [scenarioRequest?.requestId]);
  useEffect(() => {
    observedRef.current = observedSamples;
    cleanRef.current = cleanSamples;
    noiseRef.current = noiseSamples;
  }, [observedSamples, cleanSamples, noiseSamples]);
  useEffect(() => {
    if (!active && running) {
      advanceClock();
      setRunning(false);
    }
  }, [active]);
  useEffect(() => {
    if (!running) return;
    let timer: number | null = null;
    const tick = () => {
      const clock = clockRef.current;
      const now = performance.now();
      const elapsed = effectiveSimulatedSeconds(clock, now);
      const targetSamples = samplesDueForClock(clock, now, SIMULATED_SAMPLE_RATE_HZ);
      const missing = targetSamples - cursorRef.current;
      let displayElapsed = elapsed;
      if (missing > 0 && missing <= MAX_CATCH_UP_SAMPLES) {
        const blockStartSample = cursorRef.current;
        const nextBlock = temporalMode === "static"
          ? generateSimulatedSignalBlock(cursorRef.current, missing, preset, amplitudeScale, noiseSigma, noiseSeed)
          : generateTemporalSignalBlock(cursorRef.current, missing, amplitudeScale, noiseSigma, noiseSeed, temporalMode);
        cursorRef.current += nextBlock.observed.length;
        const nextObserved = appendBlock(observedRef.current, nextBlock.observed, principleDemo ? SIMULATED_WINDOW_SAMPLES : MAX_BUFFERED_SAMPLES);
        const nextClean = appendBlock(cleanRef.current, nextBlock.clean, principleDemo ? SIMULATED_WINDOW_SAMPLES : MAX_BUFFERED_SAMPLES);
        const nextNoise = appendBlock(noiseRef.current, nextBlock.noise, principleDemo ? SIMULATED_WINDOW_SAMPLES : MAX_BUFFERED_SAMPLES);
        observedRef.current = nextObserved;
        cleanRef.current = nextClean;
        noiseRef.current = nextNoise;
        setObservedSamples(nextObserved);
        setCleanSamples(nextClean);
        setNoiseSamples(nextNoise);
        if (!principleDemo) { timeFrequencyHistoryRef.current = appendTimeFrequencyHistory(timeFrequencyHistoryRef.current, nextBlock.observed, blockStartSample, SIMULATED_SAMPLE_RATE_HZ, timeFrequencyWindow, TIME_FREQUENCY_STEP_SAMPLES, TIME_FREQUENCY_MAX_HISTORY_SECONDS);
        setTimeFrequencyColumns([...timeFrequencyHistoryRef.current.columns]); }
        if (recoveryNotice && nextObserved.length >= SIMULATED_WINDOW_SAMPLES) setRecoveryNotice(null);
      } else if (missing > MAX_CATCH_UP_SAMPLES) {
        const recovered = recoverSimulatedAnalysisState(clock, now);
        cursorRef.current = recovered.cursor;
        observedRef.current = recovered.samples;
        cleanRef.current = new Float32Array();
        noiseRef.current = new Float32Array();
        displayElapsed = 0;
        setObservedSamples(observedRef.current);
        setCleanSamples(cleanRef.current);
        setNoiseSamples(noiseRef.current);
        setTimeFrequencyStartSample(0);
        setTimeFrequencyNotice("长时间阻塞后，时频历史已清空，正在等待新的完整窗口。");
        resetTimeFrequencyHistory(0);
        setRecoveryNotice("检测到长时间阻塞，已丢弃干净、噪声及加噪窗口并重新积累。");
      }
      setClockSeconds(displayElapsed);
      timer = window.setTimeout(tick, REFRESH_INTERVAL_MS);
    };
    timer = window.setTimeout(tick, REFRESH_INTERVAL_MS);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [running, preset, amplitudeScale, noiseSigma, noiseSeed, temporalMode, recoveryNotice, timeFrequencyWindow]);
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        advanceClock();
        setRunning(false);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  const status = getSimulatedAnalysisStatus(running, observedWindow.length, SIMULATED_WINDOW_SAMPLES, Boolean(recoveryNotice));
  const statusHint = getSimulatedAnalysisHint(status, observedWindow.length, SIMULATED_WINDOW_SAMPLES);
  const runControls = <div className="sim-analysis-controls analysis-run-controls">
      <button type="button" onClick={() => { startAnalysis(); notifyTraining("分析已开始"); }} disabled={running}>开始模拟分析</button>
      <button type="button" className="secondary" onClick={() => { pauseAnalysis(); notifyTraining("分析已暂停"); }} disabled={!running}>暂停</button>
      <button type="button" className="secondary" onClick={() => { pauseAnalysis(); resetBuffers(false); notifyTraining("分析已重置"); }}>重置</button>

    </div>;
  if (principleDemo) return <section id="principle-demo-analysis" className="sim-analysis-panel principle-demo-analysis" aria-label="原理演示分析">
    <div className="demo-source">数据来源：教学模拟</div>
    <label className="demo-noise">噪声强度 σ <input type="number" min="0" max="1" step="0.1" value={noiseInput} aria-invalid={Boolean(noiseError)} onChange={event => handleNoiseInput(event.target.value)} /></label>
    <details className="analysis-collapsible"><summary>高级设置</summary><div className="sim-analysis-controls">
      <label>信号幅值 <input type="number" min="0.1" max="2" step="0.1" value={amplitudeInput} onChange={event => handleAmplitudeInput(event.target.value)} /></label>
      <button className="secondary" onClick={changeNoiseSeed}>换一组噪声</button>
    </div></details>
    {(noiseError || amplitudeError) && <small role="alert">{noiseError || amplitudeError}</small>}
    <div className="demo-causal-chain">刺激 → 频域特征 → CCA 匹配 → 分类结果</div>
    <div className="demo-analysis-results">
      <AnalysisCanvas spectrumOnly targetFrequencies={demoFrequencies} observed={observedWindow} clean={cleanWindow} observedSpectrum={observedSpectrum} cleanSpectrum={cleanSpectrum} showIdeal={false} waveformLimit={waveformLimit} spectrumLimit={spectrumLimit} />

    </div>
    <small>当前响应：{preset.label} · σ={noiseSigma}；PSD 与 CCA 使用同一批模拟样本。</small>
  </section>;
  return <section id={principleDemo ? "principle-demo-analysis" : "simulated-analysis"} className={`sim-analysis-panel ${compact ? "sim-analysis-panel--compact" : ""} ${isSidebar ? "sim-analysis-panel--sidebar" : ""}`} aria-labelledby={principleDemo ? "principle-demo-title" : "sim-analysis-title"} hidden={!visible}>
    <div className={`sim-analysis-header ${actionsTarget ? "sim-analysis-header--toolbar" : ""}`}>
      <div><h3 id={principleDemo ? "principle-demo-title" : "sim-analysis-title"}>{principleDemo ? "原理演示" : "模拟信号分析"}</h3><p>同一批加噪样本同时用于时域和功率谱密度计算；不调用设备、视觉刺激或分类。</p></div>
    {!principleDemo && (actionsTarget ? visible && createPortal(runControls, actionsTarget) : runControls)}
    </div>
    <details className="analysis-collapsible analysis-signal-config" open={principleDemo ? true : configurationOpen} onToggle={(event) => setConfigurationOpen(event.currentTarget.open)} hidden={isSidebar && !principleDemo}><summary>信号配置</summary>
    <div className="sim-analysis-controls">
      {!isSidebar && <label>信号预设 <select value={presetId} onChange={(event) => changePreset(event.target.value as SimulatedPreset["id"])}>{SIMULATED_PRESETS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
      {(!isSidebar || principleDemo) && <label>信号幅值 <input type="number" min="0.1" max="2" step="0.1" value={amplitudeInput} aria-invalid={amplitudeError ? "true" : "false"} onChange={(event) => handleAmplitudeInput(event.target.value)} /></label>}
      {(!isSidebar || principleDemo) && <label>噪声强度 σ <input type="number" min="0" max="1" step="0.1" value={noiseInput} aria-invalid={noiseError ? "true" : "false"} onChange={(event) => handleNoiseInput(event.target.value)} /></label>}
      {principleDemo && <><label>图表 <select value={analysisView} onChange={event => setAnalysisView(event.target.value as "charts" | "time-frequency")}><option value="charts">时域 / PSD</option><option value="time-frequency">时频图</option></select></label><label>时频窗口 <select value={timeFrequencyWindow} onChange={event => changeTimeFrequencyWindow(Number(event.target.value) as 256 | 512)}><option value={256}>1 s</option><option value={512}>2 s</option></select></label></>}
      {!compact && !isSidebar && <label>观察视图 <select value={analysisView} onChange={(event) => setAnalysisView(event.target.value as "charts" | "time-frequency")}><option value="charts">时域＋频谱</option><option value="time-frequency">时频图</option></select></label>}
      {!compact && <><span className="sim-analysis-seed">噪声种子 {noiseSeed}</span>
        <button type="button" className="secondary" onClick={changeNoiseSeed}>换一组噪声</button>
        <label className="sim-analysis-check"><input type="checkbox" checked={showIdeal} onChange={(event) => setShowIdeal(event.target.checked)} /> 显示理想信号参考</label>
        <label>波形纵轴 <select value={waveformLimit} onChange={(event) => setWaveformLimit(Number(event.target.value))}><option value={4}>±4</option><option value={6}>±6</option><option value={8}>±8</option></select></label>
        <label>频谱视图 <select value={spectrumView} onChange={(event) => setSpectrumView(event.target.value as "full" | "background" | "expanded")}><option value="full">全量 0–3</option><option value="expanded">扩大范围 0–4</option><option value="background">频谱背景放大 0–0.12</option></select></label></>}
      {!compact && !isSidebar && <label>时频窗口 <select value={timeFrequencyWindow} onChange={(event) => changeTimeFrequencyWindow(Number(event.target.value) as 256 | 512)}><option value={256}>256 点</option><option value={512}>512 点</option></select></label>}
      {compact && !isSidebar && <details className="sim-analysis-details"><summary>参数、显示范围与计算说明</summary><div className="sim-analysis-advanced-controls">
        <label>观察视图 <select value={analysisView} onChange={(event) => setAnalysisView(event.target.value as "charts" | "time-frequency")}><option value="charts">时域＋频谱</option><option value="time-frequency">时频图</option></select></label>
        <span className="sim-analysis-seed">噪声种子 {noiseSeed}</span><button type="button" className="secondary" onClick={changeNoiseSeed}>换一组噪声</button>
        <label className="sim-analysis-check"><input type="checkbox" checked={showIdeal} onChange={(event) => setShowIdeal(event.target.checked)} /> 显示理想信号参考</label>
        <label>波形纵轴 <select value={waveformLimit} onChange={(event) => setWaveformLimit(Number(event.target.value))}><option value={4}>±4</option><option value={6}>±6</option><option value={8}>±8</option></select></label>
        <label>频谱视图 <select value={spectrumView} onChange={(event) => setSpectrumView(event.target.value as "full" | "background" | "expanded")}><option value="full">全量 0–3</option><option value="expanded">扩大范围 0–4</option><option value="background">频谱背景放大 0–0.12</option></select></label>
        <label>时频窗口 <select value={timeFrequencyWindow} onChange={(event) => changeTimeFrequencyWindow(Number(event.target.value) as 256 | 512)}><option value={256}>256 点</option><option value={512}>512 点</option></select></label>
      </div><div className="sim-analysis-preset-note">模型：clean[n] ＋ noise[n] = observed[n]。noise[n] = σ × √3 × (2u[n] − 1)，u[n] 为带种子均匀伪随机序列；这是数学教学模型，不代表真实 EEG 噪声。理想参考是模拟器已知对照，不是从含噪数据中恢复的信号；看见谱峰也不等于真实 EEG 分类成功。</div><div className="sim-analysis-preset-note">当前干净信号：{preset.components.map((component) => `${component.frequencyHz} Hz × ${component.amplitude}`).join(" ＋ ")}，信号幅值 × {amplitudeScale.toFixed(1)}，噪声强度 σ = {noiseSigma.toFixed(1)}{temporalMode === "transition12to15" ? "，5 秒处由 12 Hz 转为 15 Hz" : ""}。噪声缓冲：{noiseWindow.length} 点。</div></details>}
    </div></details>

    {amplitudeError && <p className="sim-analysis-input-error" role="alert">信号幅值：{amplitudeError}；当前仍保留上一份有效配置。</p>}
    {noiseError && <p className="sim-analysis-input-error" role="alert">噪声强度：{noiseError}；当前仍保留上一份有效配置。</p>}
    {isSidebar ? <Tooltip text={`窗口 ${SIMULATED_WINDOW_SAMPLES} 点 · 频率栅格 ${SIMULATED_FREQUENCY_BIN_HZ} Hz · 有效模拟时间 ${clockSeconds.toFixed(2)} s`}><div className="analysis-meta-bar">{SIMULATED_SAMPLE_RATE_HZ} Hz · 2 s · FFT {SIMULATED_FFT_LENGTH} · {status}</div></Tooltip> : null}
    {!isSidebar && <>
      <div className="analysis-meta-bar analysis-config-summary">{preset.label} · 幅值 {amplitudeScale} · σ={noiseSigma} · {SIMULATED_SAMPLE_RATE_HZ} Hz · FFT {SIMULATED_FFT_LENGTH} · {status}</div>
      <details className="analysis-collapsible analysis-computation-notes" open={explanationOpen} onToggle={(event) => setExplanationOpen(event.currentTarget.open)}><summary>参数与计算说明</summary>
<div className="sim-analysis-config"><span>Fs {SIMULATED_SAMPLE_RATE_HZ} Hz</span><span>窗口 {SIMULATED_WINDOW_SAMPLES} 点（N/Fs = 2 s）</span><span>FFT {SIMULATED_FFT_LENGTH} 点</span><span>频率栅格 {SIMULATED_FREQUENCY_BIN_HZ} Hz</span><span>有效模拟时间 {clockSeconds.toFixed(2)} s</span><span>状态：{status}</span></div>
    {!isSidebar && <><div className="sim-analysis-snr"><strong>模拟已知分量 SNR</strong><span>窗口 {observedWindow.length}/{SIMULATED_WINDOW_SAMPLES} 点</span><span>信号功率 Ps={snr.state === "incomplete" ? "—" : snr.signalPower.toFixed(4)}</span><span>噪声功率 Pn={snr.state === "incomplete" ? "—" : snr.noisePower.toFixed(4)}</span><span>{snr.state === "incomplete" ? "正在积累完整窗口" : snr.state === "no-noise" ? "无噪声，SNR 为 +∞" : snr.state === "no-signal" ? "无信号，SNR 为 −∞" : snr.state === "undefined" ? "SNR 未定义" : snr.state === "invalid" ? "不可计算：存在非有限样本" : `SNR = ${snr.snrDb?.toFixed(2)} dB`}</span></div>
      <p className="sim-analysis-snr-note">模拟已知分量 SNR：利用模拟器已知的理想信号与噪声计算，不代表真实 EEG 的信噪比或识别正确率；口径为原始窗口均方，不同于 PSD 的去均值与加窗。</p></>}
    {!compact && !isSidebar && <><div className="sim-analysis-preset-note">模型：clean[n] ＋ noise[n] = observed[n]。noise[n] = σ × √3 × (2u[n] − 1)，u[n] 为带种子均匀伪随机序列；这是数学教学模型，不代表真实 EEG 噪声。理想参考是模拟器已知对照，不是从含噪数据中恢复的信号；看见谱峰也不等于真实 EEG 分类成功。</div><div className="sim-analysis-preset-note">当前干净信号：{preset.components.map((component) => `${component.frequencyHz} Hz × ${component.amplitude}`).join(" ＋ ")}，信号幅值 × {amplitudeScale.toFixed(1)}，噪声强度 σ = {noiseSigma.toFixed(1)}{temporalMode === "transition12to15" ? "，5 秒处由 12 Hz 转为 15 Hz" : ""}。噪声缓冲：{noiseWindow.length} 点。</div></>}
      </details></>}
    {principleDemo && <p className="sim-analysis-hint">当前观察：{preset.label} · 幅值 {amplitudeScale} · 噪声 σ={noiseSigma}；{noiseSigma ? "比较目标峰与背景噪声的变化" : "比较频率变化后的谱峰位置"}。</p>}
    {(isSidebar && !principleDemo) || analysisView === "charts" ? <AnalysisCanvas singleChart={isSidebar} observed={observedWindow} clean={cleanWindow} observedSpectrum={observedSpectrum} cleanSpectrum={cleanSpectrum} showIdeal={showIdeal} waveformLimit={waveformLimit} spectrumLimit={spectrumLimit} /> : <div className="sim-analysis-time-frequency-wrap"><TimeFrequencyCanvas columns={timeFrequencyColumns} windowSamples={timeFrequencyWindow} /><p className="sim-analysis-time-frequency-meta">时频窗口 {timeFrequencyWindow} 点 · 步长 {TIME_FREQUENCY_STEP_SAMPLES} 点 · 已形成 {timeFrequencyColumns.length} 列 · 每列使用窗口中心时间；未满完整窗口时不生成列。</p></div>}
    {!isSidebar && timeFrequencyNotice && <p className="sim-analysis-hint" role="status">{timeFrequencyNotice}</p>}
    {!isSidebar && analysisView === "time-frequency" && timeFrequencyOverflow && <p className="sim-analysis-hint is-warning" role="status">时频图存在 PSD 超过固定色域上限 4 的列；颜色已饱和，原始数值未修改。</p>}
    <details className="analysis-runtime-details" open={isSidebar ? sheetSection === "parameters" || undefined : undefined}><summary>运行详情</summary>
    <div className="sim-analysis-footer"><span>窗口样本：{observedWindow.length}/{SIMULATED_WINDOW_SAMPLES}</span><span>样本序号：{windowStart}–{windowEnd ?? "—"}</span><span>首末样本间隔：{observedWindow.length > 1 ? ((observedWindow.length - 1) / SIMULATED_SAMPLE_RATE_HZ).toFixed(3) : "—"} s</span><span>加噪峰值：{peakText}</span></div>
    {recoveryNotice && <p className="sim-analysis-hint is-warning" role="status">{recoveryNotice}</p>}
    {observedSpectrum?.invalidSamples ? <p className="sim-analysis-hint is-warning" role="status">检测到 {observedSpectrum.invalidSamples} 个异常样本，已按 0 处理；该窗口结果请谨慎解释。</p> : <p className="sim-analysis-hint" role="status">{statusHint}</p>}
    {waveformOverflow && <p className="sim-analysis-hint is-warning" role="status">波形超过当前 ±{waveformLimit} 显示范围；原始样本未修改，请调大“波形纵轴”。</p>}
    {spectrumOverflow && <p className="sim-analysis-hint is-warning" role="status">计算 PSD 峰值超过当前 0–{spectrumLimit} 显示范围；数值未修改。若正在查看背景放大，目标峰超出该视图是正常现象。</p>}
    </details>

  </section>;
}

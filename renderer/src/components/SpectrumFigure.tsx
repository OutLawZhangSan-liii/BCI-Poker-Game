import { DEFAULT_DISPLAY_LEAD } from "../bci/signal/leads";
import { useEffect, useRef, type ReactNode } from "react";
import { drawFrequencyTicks, drawPlotAxes, plotBackground } from "./AnalysisPlotStyle";
import { EEG_PSD_UNIT } from "../bci/units";
import type { PowerSpectrum } from "../teaching/simulatedAnalysis";
const CHART_MARGIN = { left: 82, right: 18, top: 16, bottom: 48 };
const visibleTargetFrequencies = (frequencies: number[]) => [...new Set(frequencies)]
  .filter(frequency => Number.isFinite(frequency) && frequency >= 0 && frequency <= 64)
  .sort((a, b) => a - b);

export function SpectrumFrequencyLegend({ frequencies }: { frequencies: number[] }) {
  const visible = visibleTargetFrequencies(frequencies);
  if (!visible.length) return null;
  return <div className="spectrum-frequency-legend" aria-label="刺激频率参考">
    <span className="spectrum-frequency-legend__label">刺激频率</span>
    {visible.map(frequency => <span key={frequency} className="spectrum-frequency-legend__item"><i aria-hidden="true" />{frequency} Hz</span>)}
  </div>;
}

export function setupCanvas(canvas: HTMLCanvasElement) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const pixelWidth = Math.max(1, Math.floor(width * ratio)), pixelHeight = Math.max(1, Math.floor(height * ratio));
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  return { context, width, height };
}

export function drawGrid(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  yMin: number,
  yMax: number,
  yTicks: number[],
  xTicks: Array<{ value: number; label: string }>,
  xMax: number,
) {
  context.font = "12px Arial, Microsoft YaHei, sans-serif";
  const tickWidth = Math.max(...yTicks.map(value => context.measureText(value.toFixed(Math.abs(value) < 1 ? 2 : 1)).width));
  const principle = Boolean(context.canvas.closest(".principle-demo-analysis"));
  const plot = { left: principle ? Math.max(96, tickWidth + 52) : CHART_MARGIN.left, right: width - CHART_MARGIN.right, top: CHART_MARGIN.top, bottom: height - CHART_MARGIN.bottom };
  context.fillStyle = plotBackground(context);
  context.fillRect(0, 0, width, height);
  context.font = "12px Arial, Microsoft YaHei, sans-serif";
  context.textBaseline = "middle";
  context.strokeStyle = "#e0e0e0";
  context.lineWidth = 1;
  context.fillStyle = "#353535";
  yTicks.forEach((value) => {
    const y = plot.bottom - ((value - yMin) / (yMax - yMin)) * (plot.bottom - plot.top);
    context.beginPath();
    context.moveTo(plot.left, y);
    context.lineTo(plot.right, y);
    context.stroke();
    context.textAlign = "right";
    context.fillText(value.toFixed(Math.abs(value) < 1 ? 2 : 1), plot.left - 7, y);
  });
  xTicks.forEach(({ value, label }) => {
    const x = plot.left + (xMax ? value / xMax : 0) * (plot.right - plot.left);
    context.beginPath();
    context.moveTo(x, plot.top);
    context.lineTo(x, plot.bottom);
    context.stroke();
    context.textAlign = "center";
    context.fillText(label, x, plot.bottom + 14);
  });
  return { ...plot, yTickWidth: Math.max(...yTicks.map(value => context.measureText(value.toFixed(Math.abs(value) < 1 ? 2 : 1)).width)) };
}

export function clipToPlot(context: CanvasRenderingContext2D, plot: ReturnType<typeof drawGrid>) {
  context.save();
  context.beginPath();
  context.rect(plot.left, plot.top, plot.right - plot.left, plot.bottom - plot.top);
  context.clip();
}

function drawSpectrumLine(context: CanvasRenderingContext2D, spectrum: PowerSpectrum, plot: ReturnType<typeof drawGrid>, visibleMaxHz: number, yLimit: number, color: string, dashed = false) {
  const maxIndex = Math.min(spectrum.frequenciesHz.length - 1, Math.round(visibleMaxHz / spectrum.frequencyBinHz));
  context.strokeStyle = color;
  context.lineWidth = dashed ? 1.2 : 1.6;
  context.setLineDash(dashed ? [5, 4] : []);
  context.beginPath();
  for (let index = 0; index <= maxIndex; index += 1) {
    const frequency = spectrum.frequenciesHz[index];
    const value = spectrum.powerDensity[index];
    const x = plot.left + (frequency / visibleMaxHz) * (plot.right - plot.left);
    const y = plot.bottom - (value / yLimit) * (plot.bottom - plot.top);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
  context.setLineDash([]);
}

export function drawSpectrum(canvas: HTMLCanvasElement, observedSpectrum: PowerSpectrum | null, cleanSpectrum: PowerSpectrum | null, showIdeal: boolean, yLimit: number, targetFrequencies: number[] = [], powerUnit = "a.u.²/Hz") {
  const setup = setupCanvas(canvas);
  if (!setup) return;
  const { context, width, height } = setup;
  const visibleMaxHz = 64;
  const plot = drawGrid(context, width, height, 0, yLimit, [0, yLimit / 4, yLimit / 2, yLimit * 0.75, yLimit], [], visibleMaxHz);
  drawFrequencyTicks(context, plot, visibleMaxHz, "x");
  drawPlotAxes(context, plot, width, height, "频率 (Hz)", `功率谱密度 (${powerUnit})`);
  clipToPlot(context, plot);
  if (observedSpectrum) drawSpectrumLine(context, observedSpectrum, plot, visibleMaxHz, yLimit, "#0072bd");
  if (showIdeal && cleanSpectrum) drawSpectrumLine(context, cleanSpectrum, plot, visibleMaxHz, yLimit, "#d95319", true);
  visibleTargetFrequencies(targetFrequencies).forEach(frequency => {
    const x = plot.left + frequency / visibleMaxHz * (plot.right - plot.left);
    context.strokeStyle = "#7a2e31"; context.lineWidth = 1; context.setLineDash([3, 3]);
    context.beginPath(); context.moveTo(x, plot.top); context.lineTo(x, plot.bottom); context.stroke();
    context.setLineDash([]);
  });

  context.restore();
}


/** Shared PSD renderer; its only input is a computed spectrum, never generated samples. */
export function SpectrumFigure({ spectrum, channelLabel = DEFAULT_DISPLAY_LEAD, headerActions, emptyMessage, targetFrequencies = [] }: { spectrum: PowerSpectrum | null; channelLabel?: string; headerActions?: ReactNode; emptyMessage?: string; targetFrequencies?: number[] }) {
  const canvas = useRef<HTMLCanvasElement>(null), latest = useRef({ spectrum, targetFrequencies });
  latest.current = { spectrum, targetFrequencies };
  const frequencyKey = targetFrequencies.join(",");
  useEffect(() => {
    let frame: number | null = null;
    const draw = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        if (!canvas.current || document.hidden) return;
        const { spectrum: data, targetFrequencies: frequencies } = latest.current;
        let peak = 0;
        if (data) for (let i = 0; i < data.powerDensity.length && data.frequenciesHz[i] <= 64; i++) peak = Math.max(peak, data.powerDensity[i]);
        drawSpectrum(canvas.current, data, null, false, peak > 0 ? peak * 1.15 : 1, frequencies, EEG_PSD_UNIT);
      });
    };
    const observer = new ResizeObserver(draw); if (canvas.current) observer.observe(canvas.current);
    canvas.current?.addEventListener("spectrum-change", draw); draw();
    return () => { observer.disconnect(); canvas.current?.removeEventListener("spectrum-change", draw); if (frame !== null) cancelAnimationFrame(frame); };
  }, []);
  useEffect(() => { canvas.current?.dispatchEvent(new Event("spectrum-change")); }, [spectrum, frequencyKey]);
  return <article className="sim-analysis-chart-card"><div className="principle-psd-heading"><h4>真实 EEG 功率谱密度（PSD）· {channelLabel}</h4>{headerActions}</div><SpectrumFrequencyLegend frequencies={targetFrequencies} /><canvas ref={canvas} className="sim-analysis-chart" aria-label={`真实 EEG ${channelLabel} 功率谱密度`} />{!spectrum && emptyMessage && <small role="status">{emptyMessage}</small>}</article>;
}

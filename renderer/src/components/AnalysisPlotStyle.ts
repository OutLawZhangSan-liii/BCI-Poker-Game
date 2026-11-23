import { WARM_PAPER } from "../theme/presentation";
export interface PlotBounds { left: number; right: number; top: number; bottom: number; yTickWidth?: number; yLabelWidth?: number }

// Both principle-demo figures reserve the same left axis and right colorbar gutter.
export const PRINCIPLE_PLOT_LEFT = 96;
export const PLOT_REFERENCE_COLOR = "#62789D";
export function principlePlotBounds(width: number, height: number): PlotBounds {
  return { left:PRINCIPLE_PLOT_LEFT, right:Math.max(PRINCIPLE_PLOT_LEFT + 1, width - 88), top:24, bottom:Math.max(25, height - 48) };
}
// Keep labels legible on a large display, while narrow plots retain room for ticks.
export function plotFont(context: CanvasRenderingContext2D, baseSize: number) {
  const canvas = context.canvas;
  const scale = Math.max(1, Math.min(1.65, window.innerWidth / 1440, window.innerHeight / 800,
    canvas.clientWidth / 620, canvas.clientHeight / 180));
  return `${(baseSize * scale).toFixed(1)}px Arial, Microsoft YaHei, sans-serif`;
}
export function formatSpectrumTick(value: number) {
  const magnitude = Math.abs(value);
  return magnitude !== 0 && (magnitude < .01 || magnitude >= 10000) ? value.toExponential(1) : value.toFixed(magnitude < 1 ? 2 : 1);
}
export const plotReferenceFrequencies = (frequencies: readonly number[]) => [...new Set(frequencies)]
  .filter(f => Number.isFinite(f) && f >= 0 && f <= 64).sort((a,b)=>a-b);

// Frequency axis presentation: default 5 Hz labels/grid, 1 Hz tick marks.
// This does not change FFT bin spacing or interpolate the measured spectrum.
export function drawFrequencyTicks(context: CanvasRenderingContext2D, plot: PlotBounds, maxHz: number, axis: "x" | "y", gridColor: string = WARM_PAPER.border, majorStepHz = 5) {
  if (!Number.isFinite(maxHz) || maxHz <= 0) return;
  context.save();
  context.setLineDash([]);
  context.font = plotFont(context, 12);
  context.textBaseline = "middle";
  context.lineWidth = 1;
  context.fillStyle = "#353535";
  for (let frequency = 0; frequency <= Math.floor(maxHz); frequency++) {
    const major = frequency % majorStepHz === 0, length = major ? 6 : 3;
    const x = plot.left + frequency / maxHz * (plot.right - plot.left);
    const y = plot.bottom - frequency / maxHz * (plot.bottom - plot.top);
    if (major) {
      context.strokeStyle = gridColor;
      context.beginPath();
      if (axis === "x") { context.moveTo(x, plot.top); context.lineTo(x, plot.bottom); }
      else { context.moveTo(plot.left, y); context.lineTo(plot.right, y); }
      context.stroke();
      context.textAlign = axis === "y" ? "right" : frequency === 0 ? "left" : "center";
      context.fillText(String(frequency), axis === "x" ? x : plot.left - 8, axis === "x" ? plot.bottom + 14 : y);
    }
    context.strokeStyle = "#66685b";
    context.beginPath();
    if (axis === "x") { context.moveTo(x, plot.bottom); context.lineTo(x, plot.bottom + length); }
    else { context.moveTo(plot.left - length, y); context.lineTo(plot.left, y); }
    context.stroke();
  }
  context.restore();
}

// Canvas presentation only; sample values and spectrum calculations stay unchanged.
export function drawPlotAxes(context: CanvasRenderingContext2D, plot: PlotBounds, width: number, height: number, xLabel: string, yLabel: string) {
  context.save();
  context.setLineDash([]);
  context.strokeStyle = "#353535";
  context.lineWidth = 1;
  context.strokeRect(plot.left, plot.top, plot.right - plot.left, plot.bottom - plot.top);
  context.fillStyle = "#252525";
  context.font = plotFont(context, 13);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(xLabel, (plot.left + plot.right) / 2, height - 12);
  if (context.canvas.closest(".principle-demo-analysis")) {
    context.canvas.dataset.plotBounds = JSON.stringify(plot);
    context.canvas.dataset.xLabelAnchor = String((plot.left + plot.right) / 2);
  }
  const labelX = context.canvas.closest(".principle-demo-analysis") ? 20 : context.canvas.closest(".shell--teaching-observe")
    ? Math.max(16, Math.min(28, plot.left - 8 - (plot.yTickWidth ?? 24) - 12))
    : 16;
  context.translate(labelX, (plot.top + plot.bottom) / 2);
  context.rotate(-Math.PI / 2);
  context.fillText(yLabel, 0, 0, plot.yLabelWidth ?? Math.max(90, height - 20));
  context.restore();
}

export function plotBackground(context: CanvasRenderingContext2D) {
  return WARM_PAPER.panel;
}

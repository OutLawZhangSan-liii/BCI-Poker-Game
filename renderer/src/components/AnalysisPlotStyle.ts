export interface PlotBounds { left: number; right: number; top: number; bottom: number; yTickWidth?: number; yLabelWidth?: number }

// Frequency axis presentation: 5 Hz labels/grid, 1 Hz tick marks.
// This does not change FFT bin spacing or interpolate the measured spectrum.
export function drawFrequencyTicks(context: CanvasRenderingContext2D, plot: PlotBounds, maxHz: number, axis: "x" | "y", gridColor = "#e0e0e0") {
  if (!Number.isFinite(maxHz) || maxHz <= 0) return;
  context.save();
  context.setLineDash([]);
  context.font = "12px Arial, Microsoft YaHei, sans-serif";
  context.textBaseline = "middle";
  context.lineWidth = 1;
  context.fillStyle = "#353535";
  for (let frequency = 0; frequency <= Math.floor(maxHz); frequency++) {
    const major = frequency % 5 === 0, length = major ? 6 : 3;
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
  context.font = "13px Arial, Microsoft YaHei, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(xLabel, (plot.left + plot.right) / 2, height - 12);
  const labelX = context.canvas.closest(".principle-demo-analysis") ? 20 : context.canvas.closest(".shell--teaching-observe")
    ? Math.max(16, Math.min(28, plot.left - 8 - (plot.yTickWidth ?? 24) - 12))
    : 16;
  context.translate(labelX, (plot.top + plot.bottom) / 2);
  context.rotate(-Math.PI / 2);
  context.fillText(yLabel, 0, 0, plot.yLabelWidth ?? Math.max(90, height - 20));
  context.restore();
}

export function plotBackground(context: CanvasRenderingContext2D) {
  return context.canvas.closest(".shell--teaching-observe, .principle-demo-analysis") ? "#f7f7f5" : "#ffffff";
}

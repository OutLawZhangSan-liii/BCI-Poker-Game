import { drawFrequencyTicks, drawPlotAxes, plotBackground } from "./AnalysisPlotStyle";
import type { PowerSpectrum } from "../teaching/simulatedAnalysis";
import type { RealEegSnapshot } from "../teaching/realEegAnalysis";

const COLUMNS = 300; // 30 seconds at a maximum of ten new display columns per second.
const ROWS = 129;
const MIN_DB = -60, MAX_DB = 60;
const palette = new Uint8ClampedArray(256 * 3);
for (let index = 0; index < 256; index++) {
  const t = index / 255;
  palette[index * 3] = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 3))));
  palette[index * 3 + 1] = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 2))));
  palette[index * 3 + 2] = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 1))));
}

// Display-only history of the existing PSD; no second FFT or EEG processing path.
export class RealSpectrogram {
  private bitmap = document.createElement("canvas");
  private context: CanvasRenderingContext2D;
  private colorbar = document.createElement("canvas");
  private column: ImageData;
  private key = "";
  private origin: bigint | null = null;
  private lastEnd: bigint | null = null;
  private latestBin = -1;
  private count = 0;
  private writeIndex = 0;
  revision = 0;
  private sampleRate = 256;
  private hop = 26;
  private originTime = 0;
  private maxHz = 64;
  constructor() {
    this.bitmap.width = COLUMNS; this.bitmap.height = ROWS;
    this.context = this.bitmap.getContext("2d")!;
    this.column = this.context.createImageData(1, ROWS);
    this.colorbar.width = 1; this.colorbar.height = 256;
    const barContext = this.colorbar.getContext("2d")!, bar = barContext.createImageData(1, 256);
    for (let index = 0; index < 256; index++) { const color = (255 - index) * 3, offset = index * 4; bar.data[offset] = palette[color]; bar.data[offset + 1] = palette[color + 1]; bar.data[offset + 2] = palette[color + 2]; bar.data[offset + 3] = 255; }
    barContext.putImageData(bar, 0, 0);
  }
  private clear() {
    if (!this.count && this.origin === null) return;
    this.context.clearRect(0, 0, COLUMNS, ROWS);
    this.origin = this.lastEnd = null; this.count = 0; this.latestBin = -1; this.writeIndex = 0; this.revision++;
  }
  update(snapshot: RealEegSnapshot, spectrum: PowerSpectrum | null, key: string) {
    if (this.key !== key) { this.key = key; this.clear(); }
    if (snapshot.sampleRateHz) this.maxHz = Math.min(64, snapshot.sampleRateHz / 2);
    if (!spectrum || !snapshot.sampleRateHz || snapshot.windowEndSampleExclusive === null) {
      if (snapshot.state !== "paused") this.clear();
      return;
    }
    const end = snapshot.windowEndSampleExclusive;
    if (end === this.lastEnd) return;
    if (this.lastEnd !== null && (end < this.lastEnd || (snapshot.windowStartSample !== null && snapshot.windowStartSample > this.lastEnd))) this.clear();
    this.sampleRate = snapshot.sampleRateHz; this.hop = Math.max(1, Math.round(this.sampleRate / 10));
    this.maxHz = Math.min(64, this.sampleRate / 2);
    if (this.origin === null) { this.origin = end; this.originTime = Number(end) / this.sampleRate - snapshot.windowSamples / (2 * this.sampleRate); }
    const bin = Math.floor(Number(end - this.origin) / this.hop);
    this.lastEnd = end;
    if (bin === this.latestBin) return;
    const advance = Math.min(COLUMNS, Math.max(1, bin - this.latestBin));
    for (let row = 0; row < ROWS; row++) {
      const frequency = (ROWS - 1 - row) / (ROWS - 1) * this.maxHz;
      const index = Math.min(spectrum.powerDensity.length - 1, Math.round(frequency / spectrum.frequencyBinHz));
      const power = spectrum.powerDensity[index];
      const db = 10 * Math.log10(Math.max(1e-6, Number.isFinite(power) ? power : 1e-6));
      const color = Math.max(0, Math.min(255, Math.round((db - MIN_DB) / (MAX_DB - MIN_DB) * 255)));
      const offset = row * 4;
      this.column.data[offset] = palette[color * 3]; this.column.data[offset + 1] = palette[color * 3 + 1]; this.column.data[offset + 2] = palette[color * 3 + 2]; this.column.data[offset + 3] = 255;
    }
    // Every elapsed display column must be opaque, including sparse packet updates.
    // Hold the newest available window PSD across its display interval.
    for (let offset = 0; offset < advance; offset++) {
      this.context.putImageData(this.column, this.writeIndex, 0);
      this.writeIndex = (this.writeIndex + 1) % COLUMNS;
    }
    this.count = Math.min(COLUMNS, this.count + advance); this.latestBin = bin; this.revision++;
  }
  draw(canvas: HTMLCanvasElement) {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    const ratio = devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.floor(width * ratio)), pixelHeight = Math.max(1, Math.floor(height * ratio));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    const context = canvas.getContext("2d")!;
    context.setTransform(ratio, 0, 0, ratio, 0, 0); context.fillStyle = plotBackground(context); context.fillRect(0, 0, width, height);
    const plot = { left: 66, right: Math.max(67, width - 100), top: 28, bottom: Math.max(29, height - 48) };
    context.imageSmoothingEnabled = false;
    if (this.count) {
      const start = (this.writeIndex - this.count + COLUMNS) % COLUMNS;
      const first = Math.min(this.count, COLUMNS - start), scale = (plot.right - plot.left) / this.count;
      context.drawImage(this.bitmap, start, 0, first, ROWS, plot.left, plot.top, first * scale, plot.bottom - plot.top);
      if (first < this.count) context.drawImage(this.bitmap, 0, 0, this.count - first, ROWS, plot.left + first * scale, plot.top, (this.count - first) * scale, plot.bottom - plot.top);
    }
    else { context.fillStyle = "#697565"; context.font = "12px Arial, Microsoft YaHei, sans-serif"; context.textAlign = "center"; context.fillText("正在积累完整时频窗口", (plot.left + plot.right) / 2, (plot.top + plot.bottom) / 2); }
    context.font = "12px Arial, Microsoft YaHei, sans-serif"; context.textBaseline = "middle";
    const endTime = this.originTime + Math.max(0, this.latestBin) * this.hop / this.sampleRate;
    const startTime = this.count ? endTime - (this.count - 1) * this.hop / this.sampleRate : 0;
    drawFrequencyTicks(context, plot, this.maxHz, "y", "#ffffff33");
    for (let index = 0; index <= 2; index++) {
      const x = plot.left + index / 2 * (plot.right - plot.left);
      context.fillStyle = "#353535"; context.textAlign = index === 0 ? "left" : index === 2 ? "right" : "center";
      context.fillText((startTime + index / 2 * (endTime - startTime)).toFixed(1), x, plot.bottom + 14);
    }
    const barX = plot.right + 14, barHeight = plot.bottom - plot.top;
    context.drawImage(this.colorbar, barX, plot.top, 12, barHeight);
    context.fillStyle = "#353535"; context.textAlign = "left"; context.font = "11px Arial, Microsoft YaHei, sans-serif";
    context.fillText("PSD (dB)", plot.right + 4, 12);
    for (let index = 0; index <= 4; index++) context.fillText(String(MAX_DB - index / 4 * (MAX_DB - MIN_DB)), barX + 18, plot.top + index / 4 * barHeight);
    drawPlotAxes(context, plot, width, height, "时间 (s)", "频率 (Hz)");
  }
}

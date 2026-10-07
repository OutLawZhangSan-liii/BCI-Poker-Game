import { useMemo } from "react";
import type { PowerSpectrum } from "../teaching/simulatedAnalysis";
import { EEG_SAMPLE_UNIT, EEG_PSD_UNIT } from "../bci/units";

// Read-only display metrics from the existing window and PSD, never classifier input.
export function AnalysisSummary({ samples, spectrum }: { samples: Float32Array; spectrum: PowerSpectrum | null }) {
  const metrics = useMemo(() => {
    if (!samples.length || samples.some(value => !Number.isFinite(value))) return null;
    let minimum = Infinity, maximum = -Infinity;
    for (const value of samples) { minimum = Math.min(minimum, value); maximum = Math.max(maximum, value); }
    return { peakToPeak: maximum - minimum };
  }, [samples]);
  const peaks = useMemo(() => {
    if (!spectrum) return [];
    const candidates: Array<{ frequency: number; power: number }> = [];
    // Distinct local maxima in the displayed 0–64 Hz band, excluding DC.
    for (let index = 1; index < spectrum.powerDensity.length; index++) {
      const power = spectrum.powerDensity[index], frequency = spectrum.frequenciesHz[index];
      if (frequency > 64) break;
      if (Number.isFinite(power) && power > 0 && power > spectrum.powerDensity[index - 1] && (index === spectrum.powerDensity.length - 1 || power >= spectrum.powerDensity[index + 1])) candidates.push({ frequency, power });
    }
    return candidates.sort((a, b) => b.power - a.power).slice(0, 2);
  }, [spectrum]);
  const format = (value: number | undefined) => value === undefined ? "—" : value.toPrecision(4);
  return <section className="analysis-summary" aria-label="窗口指标与峰值摘要">
    <div><span>峰峰值</span><strong>{format(metrics?.peakToPeak)} <small>{EEG_SAMPLE_UNIT}</small></strong></div>
    <div><span>主峰</span><strong>{peaks[0] ? peaks[0].frequency.toFixed(2) + " Hz" : "—"}</strong><small>{peaks[0] ? format(peaks[0].power) + ` ${EEG_PSD_UNIT}` : "等待完整窗口"}</small></div>
  </section>;
}

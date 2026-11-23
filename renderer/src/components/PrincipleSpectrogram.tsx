import { useEffect, useRef } from "react";
import { SpectrumFrequencyLegend } from "./SpectrumFigure";
import { RealSpectrogram } from "./RealSpectrogram";
import { trialSpectrogramFrame } from "../teaching/trialSpectrogram";
import type { RealTrialAnalysis, PsdDisplayChannel } from "../bci/signal/types";

/** Bounded PSD-window history; no new EEG tap, FFT or classifier work. */
export function PrincipleSpectrogram({ analysis, channel, targetFrequencies = [] }: { analysis: RealTrialAnalysis | null; channel: PsdDisplayChannel; targetFrequencies?: number[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const history = useRef<RealSpectrogram | null>(null);
  const latest = useRef({ analysis, channel, targetFrequencies }); latest.current = { analysis, channel, targetFrequencies };
  useEffect(() => {
    history.current = new RealSpectrogram();
    let pending: number | null = null;
    const draw = () => {
      if (pending !== null) return;
      pending = requestAnimationFrame(() => {
        pending = null;
        if (!canvas.current || document.hidden || !canvas.current.clientWidth) return;
        const input = trialSpectrogramFrame(latest.current.analysis, latest.current.channel);
        history.current!.update(input.snapshot, input.spectrum, input.key);
        history.current!.draw(canvas.current, "", latest.current.targetFrequencies);
        canvas.current.dataset.windowStart = String(input.snapshot.windowStartSample ?? "");
        canvas.current.dataset.windowEnd = String(input.snapshot.windowEndSampleExclusive ?? "");
        canvas.current.dataset.channel = latest.current.channel;
      });
    };
    const node = canvas.current;
    const observer = new ResizeObserver(draw); if (node) observer.observe(node);
    node?.addEventListener("spectrum-change", draw); draw();
    return () => { observer.disconnect(); node?.removeEventListener("spectrum-change", draw); if (pending !== null) cancelAnimationFrame(pending); history.current = null; };
  }, []);
  useEffect(() => { canvas.current?.dispatchEvent(new Event("spectrum-change")); }, [analysis, channel, targetFrequencies.join(",")]);
  const label = channel === "mean" ? "四通道平均" : channel;
  return <article className="sim-analysis-chart-card principle-spectrogram">
    <div className="principle-psd-heading"><h4>时频图 · {label}</h4><small title="由上方同一通道的PSD窗口组成；横轴为窗口中心时刻，颜色为10log10(PSD / 1 μV²/Hz)。">dB re 1 μV²/Hz</small></div>
    <SpectrumFrequencyLegend frequencies={targetFrequencies} />
    <canvas ref={canvas} className="sim-analysis-chart" aria-label={`真实 EEG ${label} 时频图`} />
  </article>;
}

import { ANALYSIS_LEADS, DEFAULT_DISPLAY_LEAD } from "../bci/signal/leads";
import { useState } from "react";
import { DemoClassification } from "./DemoClassification";
import { SpectrumFigure } from "./SpectrumFigure";
import type { RealTrialAnalysis, PsdDisplayChannel } from "../bci/signal/types";
export function RealPrincipleAnalysis({ analysis, labels, targetFrequencies, connected, acquiring, running, progress, notice }: {
  notice: string; analysis: RealTrialAnalysis | null; labels: string[]; connected: boolean; acquiring: boolean; running: boolean;
  progress: { samples: number; requiredSamples: number; sampleRateHz: number } | null;
  targetFrequencies: number[];
}) {
  const [psdChannel, setPsdChannel] = useState<PsdDisplayChannel>(DEFAULT_DISPLAY_LEAD);
  const channelLabel = psdChannel === "mean" ? "四通道平均" : psdChannel;
  const available = connected && acquiring;
  const result = available ? analysis : null;
  const status = !connected ? "当前未连接 EEG 设备，请先连接设备" : !acquiring ? "请先开始 EEG 采集" : !running && /中断|质量不足/.test(notice) ? notice : !running && !result ? "准备：开始刺激后等待 EEG 数据" : running && /丢帧|卡顿|显示不稳定/.test(notice) ? `${notice}${progress ? ` · ${(progress.samples / progress.sampleRateHz).toFixed(1)} / ${(progress.requiredSamples / progress.sampleRateHz).toFixed(1)} s` : ""}` : progress ? `正在积累数据：${(progress.samples / progress.sampleRateHz).toFixed(1)} / ${(progress.requiredSamples / progress.sampleRateHz).toFixed(1)} s` : "等待 EEG 数据";
  return <section id="principle-demo-analysis" className="sim-analysis-panel principle-demo-analysis" aria-label="真实 EEG 原理演示分析">
    <p role="status">{result ? result.spectrum ? "真实 EEG 分析结果" : "当前数据质量不足，无法分析" : status}</p>
    <div className="demo-analysis-results"><SpectrumFigure spectrum={result?.channelSpectra[psdChannel] ?? null} channelLabel={channelLabel} targetFrequencies={targetFrequencies}
      headerActions={<label className="principle-psd-channel">显示通道 <select aria-label="PSD 显示通道" value={psdChannel} onChange={event => setPsdChannel(event.target.value as PsdDisplayChannel)}>{ANALYSIS_LEADS.map(lead => <option key={lead} value={lead}>{lead}</option>)}<option value="mean" title="四通道 PSD 逐频点算术平均">四通道平均</option></select></label>}
      emptyMessage={psdChannel === "mean" ? "四通道数据尚未完整" : `等待 ${psdChannel} EEG 数据`} /><DemoClassification analysis={result} labels={labels} status={status} /></div>
    {result && <small>同一窗口 [{result.windowStartSample}, {result.windowEndSample}) · {result.sampleRateHz} Hz；PSD 显示{channelLabel}{result.psdBandpass ? ` · ${result.psdBandpass.lowHz}～${Number(result.psdBandpass.highHz.toFixed(2))}Hz 带通 → 去均值 → Hann 窗` : ""}；FBCCA 使用 {ANALYSIS_LEADS.join(" / ")} 四通道联合匹配。</small>}
  </section>;
}

import { InlineAnalysisDetails } from "./InlineAnalysisDetails";
import { ANALYSIS_LEADS, DEFAULT_DISPLAY_LEAD } from "../bci/signal/leads";
import { useState } from "react";
import { DemoClassification } from "./DemoClassification";
import { PrincipleSpectrogram } from "./PrincipleSpectrogram";
import { SpectrumFigure } from "./SpectrumFigure";
import type { RealTrialAnalysis, PsdDisplayChannel } from "../bci/signal/types";
export function RealPrincipleAnalysis({ analysis, labels, targetFrequencies, connected, acquiring, notice }: {
  notice: string; analysis: RealTrialAnalysis | null; labels: string[]; connected: boolean; acquiring: boolean;
  targetFrequencies: number[];
}) {
  const [psdChannel, setPsdChannel] = useState<PsdDisplayChannel>(DEFAULT_DISPLAY_LEAD);
  const channelLabel = psdChannel === "mean" ? "四通道平均" : psdChannel;
  const available = connected && acquiring;
  const result = available ? analysis : null;
  const fault = /中断|质量不足|丢帧|卡顿|显示不稳定|变化|断流/.test(notice);
  return <section id="principle-demo-analysis" className="sim-analysis-panel principle-demo-analysis" aria-label="真实 EEG 原理演示分析">
    {fault && <p className="principle-analysis-status" role="status">{notice}</p>}
    <div className="demo-analysis-results"><SpectrumFigure title="功率谱" spectrum={result?.channelSpectra[psdChannel] ?? null} channelLabel={channelLabel} targetFrequencies={targetFrequencies}
      headerActions={<label className="principle-psd-channel">通道 <select aria-label="PSD 显示通道" value={psdChannel} onChange={event => setPsdChannel(event.target.value as PsdDisplayChannel)}>{ANALYSIS_LEADS.map(lead => <option key={lead} value={lead}>{lead}</option>)}<option value="mean" title="四通道 PSD 逐频点算术平均">四通道平均</option></select></label>}
      /><PrincipleSpectrogram analysis={result} channel={psdChannel} targetFrequencies={targetFrequencies} /><DemoClassification analysis={result} labels={labels} /></div>
    {result && <InlineAnalysisDetails>
      <span>窗口 <strong>[{result.windowStartSample}, {result.windowEndSample})</strong></span><span>采样率 <strong>{result.sampleRateHz} Hz</strong></span>
      <span>PSD <strong>{channelLabel}</strong></span>{result.psdBandpass&&<span>{result.psdBandpass.lowHz}–{Number(result.psdBandpass.highHz.toFixed(2))}Hz 带通</span>}
      <span>去均值 · Hann窗</span><span>FBCCA · {ANALYSIS_LEADS.join(" / ")}</span>
    </InlineAnalysisDetails>}
  </section>;
}

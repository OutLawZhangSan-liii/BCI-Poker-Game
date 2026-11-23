import { useMemo, useState } from "react";
import { computePowerSpectrumWithConfig, DEFAULT_SIMULATED_NOISE_SEED, NOISE_TEACHING_SCENARIOS, SIMULATED_SAMPLE_RATE_HZ as rate } from "../teaching/simulatedAnalysis";
import { computeKnownComponentSnr, generateTemporalSignalBlock, SNR_TEACHING_SCENARIOS } from "../teaching/simulatedAdvanced";

export function LessonSignalExample({ lesson, locked }: { lesson: "noise" | "snr"; locked: boolean }) {
  const scenarios = lesson === "noise" ? NOISE_TEACHING_SCENARIOS : SNR_TEACHING_SCENARIOS;
  const [amplitude, setAmplitude] = useState(scenarios[0].amplitudeScale);
  const [noiseSigma, setNoiseSigma] = useState(scenarios[0].noiseSigma);
  const figure = useMemo(() => {
    const { clean, noise, observed } = generateTemporalSignalBlock(0, rate * 2, amplitude, noiseSigma, DEFAULT_SIMULATED_NOISE_SEED, "static");
    const spectrum = computePowerSpectrumWithConfig(observed, rate, observed.length)!;
    const points = [];
    for (let bin = 0; spectrum.frequenciesHz[bin] <= 48; bin++) {
      const db = 10 * Math.log10(Math.max(1e-12, spectrum.powerDensity[bin]));
      const y = Math.max(0, Math.min(1, (10 - db) / 65));
      points.push(`${spectrum.frequenciesHz[bin]},${y.toFixed(4)}`);
    }
    const { snrDb, state } = computeKnownComponentSnr(clean, noise);
    let readout = "无信号、无噪声";
    if (state === "finite") readout = `信噪比 ${snrDb!.toFixed(1)} dB`;
    if (state === "no-noise") readout = "无附加噪声";
    if (state === "no-signal") readout = "仅有噪声";
    return { points: points.join(" "), readout };
  }, [amplitude, noiseSigma]);
  return <div className="teaching-interactive lesson-signal-example">
    <div className="lesson-example-choices" role="group" aria-label="模拟条件">
      {scenarios.map(item => <button type="button" key={item.id}
        aria-pressed={amplitude === item.amplitudeScale && noiseSigma === item.noiseSigma}
        disabled={locked} onClick={() => { setAmplitude(item.amplitudeScale); setNoiseSigma(item.noiseSigma); }}>
        {item.label.replace(/^场景 \d+：/, "")}</button>)}
    </div>
    <div className="lesson-signal-sliders">
      <label>信号幅值 <input type="range" aria-label="信号幅值" min="0" max="3" step="0.1" value={amplitude}
        disabled={locked} onChange={e => setAmplitude(e.target.valueAsNumber)} /><output>{amplitude.toFixed(1)}</output></label>
      <label>噪声强度 σ <input type="range" aria-label="噪声强度" min="0" max="2" step="0.1" value={noiseSigma}
        disabled={locked} onChange={e => setNoiseSigma(e.target.valueAsNumber)} /><output>{noiseSigma.toFixed(1)}</output></label>
    </div>
    <figure aria-label="模拟功率谱">
      <figcaption><strong>模拟功率谱</strong><span aria-live="polite">{figure.readout}</span></figcaption>
      <div className="lesson-example-plot">
        <div className="lesson-example-y" aria-hidden="true"><span>10 dB</span><span>−55 dB</span></div>
        <svg className="lesson-example-graph" viewBox="0 0 48 1" preserveAspectRatio="none" role="img"
          aria-label={`12 Hz 模拟信号的相对功率谱密度，幅值 ${amplitude}，噪声强度 ${noiseSigma}，${figure.readout}`}>
          <line x1="12" x2="12" y1="0" y2="1" stroke="#8ba6c5" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          <polyline points={figure.points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="lesson-example-x">{[0, 12, 24, 36, 48].map(hz => <span key={hz}>{hz} Hz</span>)}</div>
      </div>
    </figure>
  </div>;
}

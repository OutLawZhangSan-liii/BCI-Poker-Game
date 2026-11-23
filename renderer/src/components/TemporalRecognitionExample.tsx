import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_SIMULATED_NOISE_SEED, SIMULATED_SAMPLE_RATE_HZ as rate } from "../teaching/simulatedAnalysis";
import { computeTimeFrequencyColumns, generateTemporalSignalBlock, TEMPORAL_SWITCH_SECONDS, TIME_FREQUENCY_TEACHING_SCENARIOS, type TimeFrequencyColumn } from "../teaching/simulatedAdvanced";

const duration = 10;
const hopSeconds = 0.25;
const endTick = duration / hopSeconds;

// Each column becomes available only after its trailing sample window is complete.
function windowReading(columns: TimeFrequencyColumn[], tick: number, windowSeconds: number) {
  const index = tick - windowSeconds / hopSeconds;
  if (index < 0) return "积累中";
  const spectrum = columns[index].spectrum;
  const powerAt = (hz: number) => spectrum.powerDensity[Math.round(hz / spectrum.frequencyBinHz)];
  const p12 = powerAt(12), p15 = powerAt(15);
  if (Math.abs(p12 - p15) <= Math.max(p12, p15) * 0.05) return "接近";
  return p12 > p15 ? "12 Hz" : "15 Hz";
}

export function TemporalRecognitionExample({ locked }: { locked: boolean }) {
  const [scenario, setScenario] = useState(TIME_FREQUENCY_TEACHING_SCENARIOS[1]);
  const [tick, setTick] = useState(6 / hopSeconds);
  const [playing, setPlaying] = useState(false);
  const element = useRef<HTMLDivElement>(null);
  const time = tick * hopSeconds;
  const switches = scenario.temporalMode === "transition12to15";
  const inputHz = switches && time >= TEMPORAL_SWITCH_SECONDS ? 15 : 12;

  const { short, long } = useMemo(() => {
    const { observed } = generateTemporalSignalBlock(0, rate * duration, scenario.amplitudeScale, scenario.noiseSigma,
      DEFAULT_SIMULATED_NOISE_SEED, scenario.temporalMode);
    return {
      short: computeTimeFrequencyColumns(observed, rate, rate, rate * hopSeconds),
      long: computeTimeFrequencyColumns(observed, rate, 4 * rate, rate * hopSeconds),
    };
  }, [scenario]);

  useEffect(() => {
    if (!playing) return;
    if (locked || tick === endTick) { setPlaying(false); return; }
    const timer = window.setTimeout(() => setTick(tick + 1), hopSeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [playing, tick, locked]);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => { if (!entry.isIntersecting) setPlaying(false); });
    if (element.current) observer.observe(element.current);
    const onVisibility = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", onVisibility); };
  }, []);

  const shortReading = windowReading(short, tick, 1);
  const longReading = windowReading(long, tick, 4);
  const readings = [["输入频率", `${inputHz} Hz`], ["近 1 秒判频", shortReading], ["近 4 秒判频", longReading]];
  return <div ref={element} className="teaching-interactive lesson-signal-example lesson-temporal">
    <div className="lesson-example-choices" role="group" aria-label="模拟信号">
      {TIME_FREQUENCY_TEACHING_SCENARIOS.map(item => <button type="button" key={item.id} aria-pressed={item.id === scenario.id}
        disabled={locked} onClick={() => { setPlaying(false); setScenario(item); }}>{item.label}</button>)}
    </div>
    <dl className="lesson-window-readings" aria-label="模拟输入与判频结果">
      {readings.map(([label, value]) => <div key={label}><dt>{label}</dt>
        <dd data-hz={value === "15 Hz" ? 15 : value === "12 Hz" ? 12 : undefined}>{value}</dd></div>)}
    </dl>
    <figure aria-label="模拟时频图">
      <figcaption><strong>模拟时频图</strong><span>{switches ? "5 秒时输入变为 15 Hz" : "输入保持 12 Hz"} · 1 秒窗</span></figcaption>
      <div className="lesson-example-plot">
        <div className="lesson-example-y" aria-hidden="true"><span>16 Hz</span><span>10 Hz</span></div>
        <svg className="lesson-example-graph" viewBox={`0 0 ${endTick} 7`} preserveAspectRatio="none" role="img"
          aria-label={`${time} 秒时输入为 ${inputHz} Hz，1 秒窗判频 ${shortReading}，4 秒窗判频 ${longReading}`}>
          {short.filter(c => c.endSampleExclusive <= time * rate).map(c => <g key={c.startSample}>
            {Array.from({ length: 7 }, (_, y) => {
              const power = c.spectrum.powerDensity[16 - y];
              const opacity = Math.max(0, Math.min(1, (10 * Math.log10(Math.max(1e-12, power)) + 55) / 60));
              return <rect key={y} x={c.endSampleExclusive / (rate * hopSeconds) - 1} y={y} width="1" height="1" fill="currentColor" opacity={opacity} />;
            })}
          </g>)}
          {switches && <line x1={TEMPORAL_SWITCH_SECONDS / hopSeconds} x2={TEMPORAL_SWITCH_SECONDS / hopSeconds} y1="0" y2="7" stroke="#9e713f" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
          <line x1={tick} x2={tick} y1="0" y2="7" stroke="#17356b" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="lesson-example-x"><span>0 s</span><span>5 s</span><span>10 s</span></div>
      </div>
    </figure>
    <div className="lesson-time-controls">
      <button type="button" className="lesson-play" disabled={locked} onClick={() => {
        if (tick === endTick) setTick(0);
        setPlaying(!playing);
      }}>{playing ? "暂停" : tick === endTick ? "重播" : "播放"}</button>
      <label>时间 <input type="range" aria-label="回放时间" aria-valuetext={`${time} 秒`} min="0" max={endTick} value={tick}
        disabled={locked} onChange={e => { setPlaying(false); setTick(e.target.valueAsNumber); }} />
        <output>{time.toFixed(2)} s</output></label>
    </div>
  </div>;
}
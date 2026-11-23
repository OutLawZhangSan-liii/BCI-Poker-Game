import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { SettingsFold, foldChoices } from "../../components/SettingsFold";
import { extractChannel, type EegChunk } from "../../bci/protocol";
import { analysisChannelIndices, missingAnalysisLeads } from "../../bci/signal/leads";
import { stimulusLuminanceAt } from "../../bci/stimulus/phase";
import { modulationLevel } from "../../bci/stimulus/modulation";
import { clearMarkerContext, markGaze, newFlight, newMarkers, observeCommand, stepFlight, targetHz, windStrength, type Difficulty, type Direction, type WindowMode } from "./flight";
import { paintFlight, planeReady } from "./scene";
import type { Vote } from "./decoder";
import "./windway.css";

type Stage = "setup" | "flying" | "paused" | "result";
type Tap = ((chunk: EegChunk | null) => void) | null;
interface Props {
  packets: RefObject<Tap>; leads?: string[]; rate?: number; sessionId: string | null;
  onBusy: (busy: boolean) => void;
}
const windowMode: WindowMode = "dynamic";
const recordPrefix = "windway.run.v1.";
interface FlightSummary {
  gatesPassed: number;
  gatesEncountered: number;
}
export function WindwayGame({packets, leads, rate, sessionId, onBusy}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null), targets = useRef<(HTMLDivElement | null)[]>([]);
  const flight = useRef(newFlight()), markers = useRef(newMarkers());
  const dir = useRef<Direction>(0);
  const [stage, setStage] = useState<Stage>("setup"), live = useRef(false);
  const rules = useRef<HTMLDialogElement>(null);
  const [gateNumber, setGateNumber] = useState(1);
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [limit, setLimit] = useState(0), [notice, setNotice] = useState(""), [painted, setPainted] = useState(false);
  const [record, setRecord] = useState<FlightSummary | null>(null);
  const started = useRef(""), runSession = useRef<string | null>(null);
  const leadKey = leads?.join("|") ?? "";
  const indices = useMemo(() => {
    const names = leadKey.split("|"); return missingAnalysisLeads(names).length ? [] : analysisChannelIndices(names);
  }, [leadKey]);
  const ready = Boolean(sessionId && rate && rate > 90 && indices.length === 4);
  const available = painted && ready;
  const active = stage === "flying" || stage === "paused";
  useLayoutEffect(() => { onBusy(active); return () => onBusy(false); }, [active, onBusy]);
  function neutral() {
    dir.current = 0;
    targets.current.forEach(el => el?.style.removeProperty("background-color"));
  }
  function pause(reason = "") {
    if (!live.current) return;
    live.current = false; neutral(); clearMarkerContext(markers.current); setNotice(reason); setStage("paused");
  }
  function openRules() {
    if (live.current) pause();
    rules.current?.showModal();
  }
  function finish() {
    live.current = false; neutral();
    const f = flight.current, m = markers.current;
    const data = { version: 1, startedAt: started.current, endedAt: new Date().toISOString(), control: "eeg",
      difficulty: f.difficulty, windMultiplier: windStrength[f.difficulty],
      sessionId: runSession.current, windowMode, gateLimit: limit || null, elapsedSeconds: f.time,
      gatesPassed: f.passed, gatesEncountered: f.attempts, secondsInCenter: f.centerSeconds,
      centerFraction: f.time ? f.centerSeconds / f.time : null, maxFrameIntervalMs: f.maxFrameMs,
      markedSwitches: m.switches, matchedSwitches: m.matched, meanMarkedSwitchMs: m.matched ? 1000*m.latencySum/m.matched : null,
      markedCenterPeriods: m.centerMarks, pushesDuringMarkedCenter: m.centerMarks ? m.centerPushes : null };
    setRecord(data); setNotice("");
    try { localStorage.setItem(recordPrefix + started.current, JSON.stringify(data)); } catch { setNotice("本局记录未能保存到此设备。"); }
    setStage("result");
  }
  function start() {
    if (!available) return;
    if (stage === "paused" && sessionId !== runSession.current) return;
    if (stage !== "paused") {
      flight.current = newFlight(difficulty); markers.current = newMarkers(); setGateNumber(1);
      started.current = new Date().toISOString(); runSession.current = sessionId;
    }
    neutral(); setNotice(""); live.current = true; setStage("flying");
  }
  useLayoutEffect(() => {
    const el = canvas.current!;
    const draw = () => {
      const box = el.getBoundingClientRect(), scale = Math.min(window.devicePixelRatio || 1, 1.5);
      el.width = Math.max(1, Math.round(box.width * scale)); el.height = Math.max(1, Math.round(box.height * scale));
      const board = el.parentElement!;
      const bounds = board.getBoundingClientRect();
      if (active) board.style.removeProperty("--flight-center");
      else if (bounds.height) board.style.setProperty("--flight-center", `${100 * (window.innerHeight / 2 - bounds.top) / bounds.height}%`);
      paintFlight(el, flight.current, limit);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(el);
    observer.observe(el.closest(".windway-space")!);
    let mounted = true;
    void planeReady().then(() => { if (mounted) { draw(); setPainted(true); } }, () => { if(mounted) setNotice("纸飞机图像载入失败"); });
    return () => { mounted = false; observer.disconnect(); };
  }, [limit, active]);
  useEffect(() => {
    if (stage !== "flying") return;
    let frame = 0, onset: number | null = null, previous: number | null = null, remainder = 0;
    let nextIndex: bigint | null = null, lastPacket = performance.now();
    let timeout = 2000, voteAt = -Infinity;
    if (!ready || sessionId !== runSession.current) { pause("采集会话已中断"); return; }
    const worker = new Worker(new URL("./decoder.worker.ts", import.meta.url), {type:"module"});
    worker.onerror = () => pause("识别服务异常，飞行已暂停");
    worker.onmessage = ({data}: MessageEvent<Vote & {at: number; error?: string}>) => {
      if (!live.current) return;
      if (data.error) { pause(data.error); return; }
      if (!Number.isFinite(data.at) || performance.now() - data.at > Math.max(700, timeout/2)) return;
      voteAt = data.at; dir.current = data.dir; observeCommand(markers.current, data.dir, flight.current.time);
    };
    packets.current = chunk => {
      if (!live.current || onset === null) return;
      if (!chunk || chunk.sessionId !== sessionId || chunk.transportGapSuspected || chunk.sampleRateHz !== rate ||
          indices.some(i => i >= chunk.channelCount) || (nextIndex !== null && chunk.firstSampleIndex !== nextIndex)) {
        pause("EEG 数据不连续，飞行已暂停"); return;
      }
      const first = nextIndex === null;
      nextIndex = chunk.firstSampleIndex + BigInt(chunk.sampleCountPerChannel);
      lastPacket = performance.now(); timeout = Math.max(1800, 4 * chunk.sampleCountPerChannel * 1000 / chunk.sampleRateHz);
      if (first) return; // This packet can contain samples acquired before the first visible frame.
      const channels = indices.map(index => extractChannel(chunk,index));
      worker.postMessage({channels, fs:rate, mode: windowMode, receivedAt:lastPacket}, channels.map(row=>row.buffer));
    };
    const frameLoop = (now: number) => {
      if (!live.current) return;
      if (onset === null) onset = now;
      if (now - lastPacket > timeout) { pause("等待 EEG 数据超时，飞行已暂停"); return; }
      if (dir.current && now - voteAt > Math.max(700, timeout/2)) {
        dir.current = 0; observeCommand(markers.current, 0, flight.current.time);
      }
      const dt = previous === null ? 0 : (now - previous) / 1000; previous = now;
      flight.current.maxFrameMs = Math.max(flight.current.maxFrameMs, dt * 1000);
      if (dt > .5) { pause("画面中断，飞行已暂停"); return; }
      remainder += dt;
      const f = flight.current;
      const previousAttempts = f.attempts;
      let done = false;
      while (remainder >= 1/120 && !done) { done = stepFlight(f, 1/120, dir.current, limit); remainder -= 1/120; }
      if (canvas.current) paintFlight(canvas.current, f, limit);
      if (done) { finish(); return; }
      if (f.attempts !== previousAttempts) setGateNumber(f.attempts + 1);
      targetHz.forEach((hz, i) => {
        const level = modulationLevel(stimulusLuminanceAt(now, onset!, hz, 0, .5, .45));
        targets.current[i]?.style.setProperty("background-color", "rgb("+level+" "+level+" "+level+")");
      });
      frame = requestAnimationFrame(frameLoop);
    };
    const key = (e: KeyboardEvent) => {
      if (!live.current || e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === "Escape") { e.preventDefault(); pause(); return; }
      // Observer annotations never write to the flight command.
      if (e.target instanceof Element && e.target.closest("button,input,select,textarea")) return;
      const gaze = e.code === "ArrowLeft" ? -1 : e.code === "ArrowRight" ? 1 : e.code === "Space" ? 0 : null;
      if (gaze !== null) { e.preventDefault(); markGaze(markers.current, gaze, flight.current.time); }
    };
    const blur = () => pause();
    const hidden = () => { if (document.hidden) blur(); };
    window.addEventListener("keydown",key);
    window.addEventListener("blur",blur); document.addEventListener("visibilitychange",hidden);
    frame = requestAnimationFrame(frameLoop);
    return () => {
      cancelAnimationFrame(frame); worker.terminate(); packets.current = null; neutral();
      window.removeEventListener("keydown",key);
      window.removeEventListener("blur",blur); document.removeEventListener("visibilitychange",hidden);
    };
  }, [stage, limit, indices, rate, sessionId, ready, packets]);
  let status = notice;
  if (!status) {
    if (stage === "setup") {
      if (!sessionId) status = "等待开始 · 请先连接设备并开始采集";
      else if (indices.length !== 4) status = "等待开始 · 请检查 P3、P4、Oz、Pz 导联";
      else if (!ready) status = "等待开始 · 采样率须高于 90 Hz";
      else status = painted ? "等待开始" : "正在载入飞机";
    } else if (stage === "flying") {
      status = `第 ${gateNumber} 道风门 · 注视左右十字转向`;
    } else if (stage === "paused") {
      status = sessionId === runSession.current ? "飞行已暂停" : "采集会话已中断，请结束本局";
    } else {
      status = "飞行结束";
    }
  }
  return <section className={active ? "windway windway--focus" : "windway"} aria-label="纸飞机">
    <div className="windway-tools">
      {stage === "setup" && <SettingsFold scope="纸飞机" rows={[
        { key: "mode", label: "难度", choices: foldChoices<Difficulty>(["easy", "hard"], difficulty, v => v === "easy" ? "简单 · 无风" : "困难 · 有风", setDifficulty) },
        { key: "length", label: "局长", choices: foldChoices([10, 0], limit, v => v ? "10 轮" : "不限轮数", setLimit) },
      ]} />}
      <p className="windway-status" role="status">{status}</p>
      <div className="windway-buttons">
      {stage === "flying" && <button onClick={()=>pause()}>暂停</button>}
      {stage === "paused" && <button disabled={!available || runSession.current !== sessionId} onClick={start}>继续飞行</button>}
      {active && <button onClick={finish}>结束飞行</button>}
      {stage === "result" && <button onClick={()=>{flight.current = newFlight(difficulty); if (canvas.current) paintFlight(canvas.current, flight.current, limit); setStage("setup"); setNotice("");}}>再飞一局</button>}
      <button type="button" className="secondary windway-rules-trigger" aria-haspopup="dialog" onClick={openRules}>
        <svg className="paper-action-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5C9 3 5 3 2.5 4l.5 15c3-1 6-1 9 1 3-2 6-2 9-1l.5-15C19 3 15 3 12 5Zm0 0v15M5 8l4 .5M5 12l4 .5m6-4 4-.5m-4 4 4-.5" /></svg>规则
      </button>
      </div>
    </div>
    <dialog ref={rules} className="windway-rules game-rules-modal" aria-labelledby="windway-rules-title">
      <div className="game-modal__header">
        <h2 id="windway-rules-title">纸飞机飞行规则</h2>
        <form method="dialog"><button type="submit" className="secondary" autoFocus>关闭</button></form>
      </div>
      <h3>穿过风门</h3>
      <p>注视左下方十字向左飞，注视右下方十字向右飞。让飞机对准前方拱门，从门内穿过。两翼都从门内通过，才记为穿过一道。擦到门框时，这道门会变红。</p>
      <h3>难度与局长</h3>
      <p>简单模式无风，困难模式有交替侧风。每遇到一道风门算一轮。选 10 轮会自动结束，选不限轮数可随时结束飞行。</p>
      <p className="windway-rules-note">按 Esc 暂停。飞行中打开规则也会暂停，关闭后点「继续飞行」起飞。</p>
    </dialog>
    <div className="windway-space"><div className="windway-board">
      <canvas ref={canvas} aria-label="纸飞机与风门"/>
      {targetHz.map((hz,i)=><div key={hz} className={"windway-target windway-target-"+i} role="img"
        aria-label={i===0?"左刺激块":"右刺激块"} ref={el=>{targets.current[i]=el;}}><span aria-hidden="true"/></div>)}
      {stage === "result" && record && <section className="windway-summary" aria-labelledby="windway-summary-title">
        <h2 id="windway-summary-title">本局飞行</h2>
        <dl>
          <div>
            <dt>穿过风门</dt>
            <dd>{record.gatesPassed} 道</dd>
            <dd className="windway-summary-note">{record.gatesEncountered ? `共遇到 ${record.gatesEncountered} 道` : "尚未到达第一道风门"}</dd>
          </div>
          <div>
            <dt>风门通过率</dt>
            <dd>{record.gatesEncountered > 0 ? `${Math.round(100 * record.gatesPassed / record.gatesEncountered)}%` : "—"}</dd>
          </div>
        </dl>
      </section>}
    </div></div>
    {stage === "setup" && <div className="game-start-action">
      <button className="game-console__primary" disabled={!available} onClick={start}>开始飞行</button>
    </div>}
  </section>;
}

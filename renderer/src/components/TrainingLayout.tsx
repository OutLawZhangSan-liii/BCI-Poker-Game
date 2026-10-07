import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { StatusBadge } from "./StatusBadge";

type SheetSection = "waveform" | "spectrum" | "feedback" | "parameters";
const SheetContext = createContext<{ section: SheetSection; select: (section: SheetSection) => void } | null>(null);
export const useAnalysisSection = () => useContext(SheetContext)?.section;
export const notifyTraining = (message: string) => window.dispatchEvent(new CustomEvent("training-notification", { detail: message }));

export function TrainingControlBar({ children, trial, realEeg, running, preparing, result, error, mode = "operation", countdown = 0 }: {
  mode?: "principle" | "operation"; countdown?: number; children: ReactNode; trial: number; realEeg: boolean; running: boolean; preparing: boolean; result: string; error?: string | null;
}) {
  const [notice, setNotice] = useState("");
  const previous = useRef({ running, result, error });
  useEffect(() => {
    const before = previous.current;
    if (error && error !== before.error) setNotice("操作失败：" + error);
    else if (running && !before.running) setNotice(mode === "principle" ? "演示已开始" : "训练已开始");
    else if (!running && before.running) setNotice(mode === "principle" ? "演示已停止" : result.includes("暂停") ? "训练已暂停" : "试次已结束");
    previous.current = { running, result, error };
  }, [running, result, error]);
  useEffect(() => {
    const onNotice = (event: Event) => setNotice((event as CustomEvent<string>).detail);
    window.addEventListener("training-notification", onNotice);
    return () => window.removeEventListener("training-notification", onNotice);
  }, []);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(""), 2200); return () => window.clearTimeout(timer); }, [notice]);
  const state = countdown ? `${countdown} 秒后开始` : preparing ? "检查显示" : running ? "运行中" : /丢帧|隐藏|变化/.test(result) ? "异常" : result.includes("暂停") ? "暂停" : mode === "principle" ? "待机" : trial ? "已完成" : "待机";
  return <div className="teaching-actions training-control-bar" aria-label="训练控制栏">
    <div className="training-control-actions">{children}</div>
    <div className="training-status-chips">
      <StatusBadge value={realEeg ? "实时 EEG" : "等待 EEG"} tone={realEeg ? "success" : "neutral"} hint={realEeg ? "活动采集会话中的 EEG 候选仅用于教学反馈，不写入正式校准。" : "请先连接 EEG 设备并开始采集；不会生成替代分析结果。"} />
      <StatusBadge value={state} tone={state === "异常" ? "danger" : running || state === "已完成" ? "success" : "neutral"} />
    </div>
    {notice && mode === "principle" && <div className="training-toast" role="status" aria-live="polite">{notice}</div>}
  </div>;
}

export function AnalysisDrawer({ open, onToggle, locked, children, collapsible = true, principleDemo = false }: { principleDemo?: boolean; open: boolean; onToggle: () => void; locked: boolean; children: ReactNode; collapsible?: boolean }) {
  const id = useId();
  const [small, setSmall] = useState(() => window.matchMedia("(max-width: 1399px), (max-height: 800px)").matches);
  const [section, setSection] = useState<SheetSection>("waveform");
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1399px), (max-height: 800px)");
    const sync = () => setSmall(query.matches);
    query.addEventListener("change", sync); return () => query.removeEventListener("change", sync);
  }, []);
  useEffect(() => { if (small && locked && open) onToggle(); }, [small, locked, open, onToggle]);
  useEffect(() => { if (principleDemo) setSection(previous => previous === "feedback" ? "waveform" : previous); }, [principleDemo]);
  const select = (next: SheetSection) => { if (!open || next === section) onToggle(); setSection(next); };
  return <>
    {collapsible && <div className="analysis-drawer-heading"><button type="button" className="secondary" onClick={onToggle} disabled={locked}
      aria-expanded={open} aria-controls={id} aria-label={open ? "收起分析区域" : "展开分析区域"}
      title={locked ? "训练期间保持布局稳定；结束后可调整分析区域。" : open ? "收起分析区域" : "展开分析区域"}>{open ? "分析 ‹" : "›"}</button></div>}
    {collapsible && <div className="analysis-sheet-tabs" aria-label="底部分析入口">
      {([ ["waveform", "波形"], ["spectrum", "频谱"], ["feedback", "反馈"], ["parameters", "参数"] ] as const).filter(([key]) => !principleDemo || key !== "feedback").map(([key, label]) => <button key={key} type="button" aria-expanded={open && section === key} aria-controls={id}
        className={open && section === key ? "" : "secondary"} disabled={locked} onClick={() => select(key)}>{label}</button>)}
      <button type="button" className="secondary" disabled={locked} aria-label={open ? "收起底部分析" : "展开底部分析"} onClick={onToggle}>{open ? "▼" : "▲"}</button>
    </div>}
    <SheetContext.Provider value={small && collapsible ? { section, select: setSection } : null}>
      <div id={id} className="analysis-drawer-content" data-section={small && collapsible ? section : "all"} hidden={!open}>{children}</div>
    </SheetContext.Provider>
  </>;
}

export function SignalViewer({ waveform, spectrum, channelControl }: { waveform: ReactNode; spectrum: ReactNode; channelControl?: ReactNode }) {
  const [view, setView] = useState<"waveform" | "spectrum">("waveform");
  const sheet = useContext(SheetContext);
  const selectedView = sheet && (sheet.section === "waveform" || sheet.section === "spectrum") ? sheet.section : view;
  const id = useId();
  return <div className="signal-viewer">
    <div className="signal-viewer-toolbar"><div role="tablist" aria-label="信号图表">
      {([ ["waveform", "时域波形"], ["spectrum", "功率谱"] ] as const).map(([key, label]) => <button type="button" role="tab" key={key}
        id={`${id}-${key}-tab`} aria-selected={selectedView === key} aria-controls={`${id}-${key}`} className={selectedView === key ? "" : "secondary"}
        onClick={() => { setView(key); sheet?.select(key); }} title={key === "spectrum" ? "同一分析窗口的功率谱密度；谱峰不等于分类成功。" : "当前通道的时域采样波形。"}>{label}</button>)}
    </div>{channelControl}</div>
    <div id={`${id}-waveform`} role="tabpanel" aria-labelledby={`${id}-waveform-tab`} hidden={selectedView !== "waveform"}>{waveform}</div>
    <div id={`${id}-spectrum`} role="tabpanel" aria-labelledby={`${id}-spectrum-tab`} hidden={selectedView !== "spectrum"}>{spectrum}</div>
  </div>;
}

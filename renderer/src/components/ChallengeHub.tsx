import { canResumePresentation } from "../theme/presentation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CHALLENGE_MODES, challengeMetrics, groupKey, rankChallenges, type ChallengeConfiguration, type ChallengeRecord, type ChallengeMode, type RankingStrategy } from "../../../desktop/main/challengeModel";
import { GAME_PRESENTATION } from "../game/presentation";
import "./ChallengeHub.css";

export type GamePage = "challenge" | "rankings" | "free" | "resume";
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const seconds = (value: number | null) => value === null ? "—" : `${(value / 1000).toFixed(2)} 秒`;
const date = (value: string) => new Date(value).toLocaleString("zh-CN", { hour12: false });
const names: Record<RankingStrategy, string> = { overall: "综合榜", accuracy: "准确榜", speed: "速度榜", streak: "连胜榜" };
function ChallengeDialog({ children, titleId, wide = false, busy = false, open = true, onClose }: {
  children: ReactNode; titleId: string; wide?: boolean; busy?: boolean; open?: boolean; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current!;
    dialog.showModal();
    return () => { dialog.close(); if (previous?.isConnected) previous.focus(); };
  }, [open]);
  return <dialog ref={ref} className={`challenge-dialog ${wide ? "challenge-dialog--wide" : ""}`} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>{children}</dialog>;
}
export function ChallengeEntry({ busy, error, active, canResume, onRankings, onResume, onClose, onCreate }: {
  busy: boolean; error: string | null; active: boolean; canResume: boolean; onRankings: () => void; onResume: () => void;
  onClose: () => void; onCreate: (studentId: string, name: string) => void;
}) {
  const [studentId, setStudentId] = useState(""), [name, setName] = useState("");
  const [rules, setRules] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (rules) heading.current?.focus(); }, [rules]);
  return <ChallengeDialog titleId="challenge-entry-title" busy={busy} open={active} onClose={onClose}>
    {!rules ? <form className="challenge-identity" onSubmit={event => { event.preventDefault(); if (studentId.trim() && name.trim()) setRules(true); }}>
      <h2 id="challenge-entry-title">三关挑战</h2>
      <label>学号<input name="studentId" type="text" maxLength={80} required value={studentId} onChange={e => setStudentId(e.target.value)} autoComplete="off" autoFocus /></label>
      <label>姓名<input name="participantName" type="text" maxLength={80} required value={name} onChange={e => setName(e.target.value)} autoComplete="off" /></label>
      <div className="challenge-entry-footer">
        <div className="challenge-entry-tools" aria-label="挑战记录">
          <button type="button" onClick={onRankings} disabled={busy}>排行榜</button>
          <button type="button" onClick={onResume} disabled={busy || !canResume} title={canResume ? "查看未完成挑战" : "暂无未完成挑战"}>继续挑战</button>
        </div>
        <div className="challenge-dialog-actions"><button type="button" className="secondary" onClick={onClose}>取消</button><button type="submit" disabled={!studentId.trim() || !name.trim()}>下一步</button></div>
      </div>
    </form> : <section className="challenge-brief-rules">
      <h2 id="challenge-entry-title" ref={heading} tabIndex={-1}>挑战规则</h2>
      <p>简单 → 进阶 → 困难，每关10轮。</p>
      <p>注视比参考牌大、且最接近参考牌的一张候选牌，完成选牌。</p>
      <p>每轮只识别一次；错误或拒识进入下一轮，连胜归零。完成三关后参与排名。</p>
      {error && <p className="challenge-entry-error" role="alert">{error}</p>}
      <div className="challenge-dialog-actions"><button className="secondary" onClick={() => setRules(false)} disabled={busy}>返回</button><button onClick={() => onCreate(studentId.trim(), name.trim())} disabled={busy}>{busy ? "准备中…" : "开始挑战"}</button></div>
    </section>}
  </ChallengeDialog>;
}
export function ChallengeMetricNote() {
  return <details className="challenge-explanation"><summary>成绩如何计算</summary>
    <p>每关10轮。正确率＝正确轮数÷完成轮数；错误和拒识都占一轮，拒识不重试。每轮只进行一次有效识别，因此首次正确率与最终正确率相同。</p>
    <p>识别用时从应用记录的首个刺激绘制帧到决策或超时，包含分析等待，不含发牌、观察、倒计时和休息。它不是光电测得的屏幕响应时间。</p>
    <p>错误或拒识中断连胜，进入下一关重新计数。正确率包含牌面规则判断与脑电识别的共同影响。速度榜要求正确率达到70%。</p>
  </details>;
}
function Metrics({ record, mode }: { record: ChallengeRecord; mode?: ChallengeMode }) {
  const m = challengeMetrics(record, mode);
  return <div className="challenge-metrics">
    <div><span>正确率</span><strong>{percent(m.firstAccuracy)}</strong></div>
    <div><span>平均识别用时</span><strong>{seconds(m.meanMs)}</strong></div>
    <div><span>最长连胜</span><strong>{m.longestStreak}</strong></div>
    <div><span>得分</span><strong>{m.score}</strong></div>
    <p>已完成 {m.completed} 轮 · 正确 {m.correct} · 错误 {m.incorrect} · 拒识 {m.rejected}</p>
  </div>;
}
function Breakdown({ record }: { record: ChallengeRecord }) {
  return <div className="challenge-table-scroll"><table className="challenge-table"><thead><tr><th>模式</th><th>完成</th><th>正确率</th><th>平均用时</th><th>拒识</th><th>连胜</th></tr></thead>
    <tbody>{CHALLENGE_MODES.map(mode => { const m = challengeMetrics(record, mode); return <tr key={mode}><th>{GAME_PRESENTATION[mode].name}</th><td>{m.completed}/10</td><td>{percent(m.firstAccuracy)}</td><td>{seconds(m.meanMs)}</td><td>{m.rejected}</td><td>{m.longestStreak}</td></tr>; })}</tbody></table></div>;
}
export function ChallengeResults({ record, mode, records, restSeconds, onContinue, onRankings, onAgain, onHome }: {
  record: ChallengeRecord; mode: ChallengeMode; records: ChallengeRecord[]; restSeconds: number;
  onContinue: () => void; onRankings: () => void; onAgain: () => void; onHome: () => void;
}) {
  const complete = record.status === "completed";
  const rank = rankChallenges(records, "overall", record.configuration).find(r => r.record.id === record.id)?.rank;
  return <section className="game-table-results challenge-results" aria-labelledby="challenge-result-title">
    <span className="eyebrow">{record.name} · {complete ? date(record.completedAt!) : "三关挑战"}</span>
    <h2 id="challenge-result-title">{complete ? "三关挑战完成" : `${GAME_PRESENTATION[mode].name}模式完成`}</h2>
    {complete && <p className="challenge-rank">本次综合排名 <strong>{rank === undefined ? "正在读取" : `第 ${rank} 名`}</strong></p>}
    <Metrics record={record} mode={complete ? undefined : mode} />
    <Breakdown record={record} /><ChallengeMetricNote />
    {!complete && restSeconds > 0 && <p role="status">休息 {restSeconds} 秒后可进入下一关</p>}
    <div className="game-result-actions">
      {complete ? <><button onClick={onRankings}>查看排行榜</button><button className="secondary" onClick={onAgain}>再次挑战</button></>
        : <button onClick={onContinue} disabled={restSeconds > 0}>进入{GAME_PRESENTATION[CHALLENGE_MODES[CHALLENGE_MODES.indexOf(mode) + 1]].name}</button>}
      <button className="secondary" onClick={onHome}>返回首页</button>
    </div>
  </section>;
}
export function ChallengeHub({ page, onPage, records, configuration, current, highlightId, busy, warnings, onResume, onReload }: {
  page: GamePage; onPage: (page: GamePage) => void; records: ChallengeRecord[]; configuration: ChallengeConfiguration;
  current: ChallengeRecord | null; highlightId?: string; busy: boolean; warnings: string[];
  onResume: (id: string) => void; onReload: () => void;
}) {
  const [strategy, setStrategy] = useState<RankingStrategy>("overall");
  const [selectedGroup, setSelectedGroup] = useState<string>("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const groups = new Map<string, ChallengeConfiguration>([[JSON.stringify(configuration), configuration]]);
  records.forEach(r => groups.set(groupKey(r), r.configuration));
  const chosenConfiguration = groups.get(selectedGroup) ?? configuration;
  const rows = rankChallenges(records, strategy, chosenConfiguration);
  const unfinished = records.filter(r => r.status !== "completed");
  return <ChallengeDialog titleId="challenge-hub-title" wide busy={busy} onClose={() => onPage("free")}><div className="challenge-hub">
    <div className="challenge-board-heading">
      <h2 id="challenge-hub-title">{page === "rankings" ? "排行榜" : "继续挑战"}</h2>
      <div className="challenge-board-tools">
        {page === "rankings" && <button className="secondary" onClick={onReload} disabled={busy}>刷新</button>}
        <button className="secondary" onClick={() => onPage("free")} disabled={busy}>关闭</button>
      </div>
    </div>
    {warnings.map(w => <p role="status" key={w}>{w}</p>)}
    {page === "resume" && <section className="challenge-resume" aria-label="未完成挑战">
        {!unfinished.length && <p>暂无未完成记录</p>}
        {unfinished.map(r => <article key={r.id}><strong>{r.name} · 学号尾号 {r.studentId.slice(-4)}</strong><p>{date(r.createdAt)} · 已完成 {challengeMetrics(r).completed}/30 轮</p>
          <button className="secondary" disabled={busy || !canResumePresentation(r.configuration, configuration)} onClick={() => onResume(r.id)}>继续</button>
          {!canResumePresentation(r.configuration, configuration) && <small>历史配置与当前版本不同，保留记录</small>}</article>)}
      </section>}
    {page === "rankings" && <section className="challenge-leaderboard" aria-label="排行榜">
      {groups.size > 1 && <label>成绩组<select value={JSON.stringify(chosenConfiguration)} onChange={e => setSelectedGroup(e.target.value)}>{[...groups].map(([key, config], i) => <option key={key} value={key}>{i === 0 ? "当前配置" : `历史配置 ${i}`} · {config.ruleVersion}</option>)}</select></label>}
      <nav className="challenge-nav" aria-label="排名策略">{Object.entries(names).map(([key, label]) => <button key={key} aria-current={strategy === key ? "page" : undefined} onClick={() => setStrategy(key as RankingStrategy)}>{label}</button>)}</nav>
      <p className="challenge-ranking-description">{strategy === "overall" ? "正确率优先，同分比较平均用时，再比较最长连胜。" : strategy === "accuracy" ? "按正确率排名，再比较拒识次数。" : strategy === "speed" ? "正确率达到70%方可上榜，比较正确轮次的平均识别用时。" : "按单关最长连胜排名，同分比较正确率和平均用时。"}</p>
      {strategy === "speed" && current?.status === "completed" && challengeMetrics(current).firstCorrect < 21 && <p role="status">本次正确率 {percent(challengeMetrics(current).firstAccuracy)}，未达到速度榜70%的门槛；其他榜单仍保留本次成绩。</p>}
      <div className="challenge-table-scroll"><table className="challenge-table"><thead><tr><th>名次</th><th>姓名</th><th>学号尾号</th><th>正确率</th><th>{strategy === "speed" ? "正确轮用时" : "平均用时"}</th><th>连胜</th><th>完成时间</th><th>详情</th></tr></thead><tbody>
        {rows.map(row => <LeaderboardRow key={row.record.id} row={row} speed={strategy === "speed"} highlight={row.record.id === highlightId} expanded={expanded === row.record.id} onToggle={() => setExpanded(expanded === row.record.id ? null : row.record.id)} />)}
      </tbody></table></div>
      {!rows.length && <p className="challenge-empty">暂无符合条件的完整成绩</p>}
      <ChallengeMetricNote />
    </section>}
  </div></ChallengeDialog>;
}
function LeaderboardRow({ row, speed, highlight, expanded, onToggle }: { row: ReturnType<typeof rankChallenges>[number]; speed: boolean; highlight: boolean; expanded: boolean; onToggle: () => void }) {
  return <><tr className={highlight ? "is-current" : undefined}><td>{row.rank}</td><th>{row.record.name}{highlight && <small> 本次</small>}</th><td>{row.record.studentId.slice(-4)}</td><td>{percent(row.metrics.firstAccuracy)}</td><td>{seconds(speed ? row.metrics.correctMeanMs : row.metrics.meanMs)}</td><td>{row.metrics.longestStreak}</td><td>{date(row.record.completedAt!)}</td><td><button className="secondary" aria-expanded={expanded} onClick={onToggle}>{expanded ? "收起" : "展开"}</button></td></tr>
    {expanded && <tr><td colSpan={8}><Breakdown record={row.record} /><p>拒识 {row.metrics.rejected} 次 · 总分 {row.metrics.score}</p></td></tr>}</>;
}

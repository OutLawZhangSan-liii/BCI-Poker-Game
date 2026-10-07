import { useState } from "react";
import type { RoundState } from "../teaching/operationRound";

const condition = { LEFT_ONLY: "左牌单闪", RIGHT_ONLY: "右牌单闪", BOTH: "双牌同闪" };
const outcome = { correct: "✓ 正确", incorrect: "✕ 错误", rejected: "— 拒识" };
export function OperationRoundResults({ round, onRestart, onClose }: { round: RoundState; onRestart: () => void; onClose: () => void }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const single = round.results.filter(result => result.stimulusMode !== "BOTH");
  const dual = round.results.filter(result => result.stimulusMode === "BOTH");
  return <section className="operation-round-results" aria-label="本轮训练结果">
    <header><h2>本轮完成 <small>{round.completed} / 4 试次</small></h2>
      <p className="round-result-totals">正确 {round.correct} · 错误 {round.incorrect} · 拒识 {round.rejected}</p>
      <p className="round-result-subtotal">单刺激正确 {single.filter(result => result.outcome === "correct").length} / {single.length} · 双刺激正确 {dual.filter(result => result.outcome === "correct").length} / {dual.length}</p>
    </header>
    <div className="round-result-list">{round.results.map(result => <div key={result.index} className={`round-result-entry round-result-entry--${result.outcome}`}>
      <button className="round-result-row" aria-expanded={expanded === result.index} aria-controls={`round-cca-${result.index}`} onClick={() => setExpanded(expanded === result.index ? null : result.index)}>
        <strong>试次 {result.index + 1}</strong><span>{condition[result.stimulusMode]}</span>
        <span title={result.targetLabel}>目标 {result.targetFrequencyHz} Hz</span>
        <span title={result.predictedLabel ?? "拒识"}>分类 {result.predictedFrequencyHz === null ? "拒识" : `${result.predictedFrequencyHz} Hz`}</span>
        <strong>{outcome[result.outcome]}</strong><span aria-hidden="true">{expanded === result.index ? "▾" : "▸"}</span>
      </button>
      {expanded === result.index && <div id={`round-cca-${result.index}`} className="round-result-cca">
        {result.matches.length ? [...result.matches].sort((a, b) => b.score - a.score).map(match => {
          const score = Number.isFinite(match.score) ? Math.max(0, match.score) : 0;
          return <div key={match.frequencyHz} className="round-result-match"><span>{match.frequencyHz} Hz</span><div className="round-result-track"><i style={{ transform: `scaleX(${score / (score + 3)})` }} /></div><span>ρ = {match.correlation.toFixed(3)} · 分数 {match.score.toFixed(2)}</span></div>;
        }) : <p>本试次没有有效 CCA 分析窗口</p>}
        <p>最终分类：{result.predictedFrequencyHz === null ? "拒识" : `${result.predictedLabel} · ${result.predictedFrequencyHz} Hz`} · {outcome[result.outcome]}</p>
      </div>}
    </div>)}</div>
    <footer><button onClick={onRestart}>再来一轮</button><button className="secondary" onClick={onClose}>返回训练待机</button></footer>
  </section>;
}

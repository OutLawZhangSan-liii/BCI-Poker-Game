import { GAME_PRESENTATION } from "../game/presentation";
import type { GameMode } from "../game/engine";
import type { ReactNode } from "react";

interface Props {
  mode: GameMode; round: number; length: number; score: number; streak: number;
  status: string; countdown: number; feedback: string | null; selectedLabel: string | null;
  correct: number; incorrect: number; rejected: number; finished: boolean; restSeconds: number;
  onExit: () => void; onReplay: () => void; onNextMode: () => void;
  participant?: string; challengeResults?: ReactNode;
}

export function GameTableHud(props: Props) {
  const mode = GAME_PRESENTATION[props.mode];
  const accepted = props.feedback?.includes("正确，+");
  const rejected = props.feedback?.includes("拒识");
  const gained = props.feedback?.match(/正确，\+(\d+)/)?.[1];
  return <div className="game-focus-overlay">
    <div className="game-focus-top">
      <div className="game-focus-left"><button className="game-exit" onClick={props.onExit}>← 退出本局</button>
        {props.participant && <span className="game-hud-pill game-hud-participant" title={props.participant}>{props.participant}</span>}
        <span className="game-hud-pill">{mode.name}</span></div>
      <div className="game-round-progress" aria-label={`第 ${Math.min(props.round + 1, props.length)} 轮，共 ${props.length} 轮，已完成 ${props.correct + props.incorrect + props.rejected} 轮`}>
        <div className="game-round-progress__number">第<strong>{Math.min(props.round + 1, props.length)}</strong>轮 <span>/ {props.length}</span></div>
        <div className="game-round-dots" aria-hidden="true">{Array.from({ length: props.length }, (_, index) => <i key={index} className={index < props.correct + props.incorrect + props.rejected ? "is-complete" : !props.finished && index === props.round ? "is-active" : ""} />)}</div>
      </div>
      <span className="game-hud-pill game-focus-score">得分 {props.score} · 连胜 {props.streak}</span>
    </div>
    {!props.finished && <div className="game-focus-stage" role="status">{props.status}</div>}
    {props.countdown > 0 && !props.finished && <div className="game-countdown" role="status" aria-label={`${props.countdown} 秒后开始`}>
      <strong>{props.countdown}</strong><span>准备注视</span>
    </div>}
    {props.feedback && !props.finished && <div className={`game-table-feedback ${rejected ? "is-muted" : accepted ? "is-correct" : "is-wrong"}`} role="status">
      <span>{rejected ? "未确定" : `识别：${props.selectedLabel ?? "—"}`}</span>
      <strong>{rejected ? "本轮未成功，进入下一轮" : accepted ? "✓ 正确" : "✕ 错误"}</strong>
      {accepted && <span>+{gained}</span>}
    </div>}
    {props.finished && props.challengeResults}
    {props.finished && !props.challengeResults && <section className="game-table-results" aria-labelledby="game-results-title">
      <span className="eyebrow">{mode.name}</span><h2 id="game-results-title">本局完成</h2>
      <div className="game-results-grid">
        <div><span>得分</span><strong>{props.score}</strong></div><div><span>正确</span><strong>{props.correct}</strong></div>
        <div><span>错误</span><strong>{props.incorrect}</strong></div><div><span>拒识</span><strong>{props.rejected}</strong></div>
      </div>
      <p>已完成{mode.name}模式{mode.next ? `，可以尝试${GAME_PRESENTATION[mode.next].name}。` : "。"}</p>
      {props.restSeconds > 0 && <small role="status">休息 {props.restSeconds} 秒后可开始新的一局</small>}
      <div className="game-result-actions"><button onClick={props.onReplay} disabled={props.restSeconds > 0}>再来一局</button>
        <button className="secondary" onClick={props.onNextMode}>{mode.nextLabel}</button>
        {mode.next && <button className="secondary" onClick={props.onExit}>返回设置</button>}
      </div>
    </section>}
  </div>;
}

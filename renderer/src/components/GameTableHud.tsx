import { GAME_PRESENTATION } from "../game/presentation";
import type { GameMode } from "../game/engine";
import type { ReactNode } from "react";

interface Props {
  mode: GameMode; round: number; length: number; score: number; streak: number;
  status: string; countdown: number; feedback: string | null; selectedLabel: string | null;
  correct: number; incorrect: number; rejected: number; finished: boolean; restSeconds: number;
  onExit: () => void; onReplay: () => void; onNextMode: () => void;
  bottomPrompt?: boolean;
  participant?: string; challengeResults?: ReactNode;
}

export function GameTableHud(props: Props) {
  const mode = GAME_PRESENTATION[props.mode];
  const accepted = props.feedback?.includes("正确，+");
  const rejected = /拒识|未确定|不确定/.test(props.feedback ?? "");
  const gained = props.feedback?.match(/正确，\+(\d+)/)?.[1];
  const resultMark = rejected ? "M8 7c0-5 8-5 8 0 0 3-4 3-4 6m0 5v1" : accepted ? "m4 12 5 5L20 5" : "m6 6 12 12M18 6 6 18";
  return <div className={`game-focus-overlay${props.bottomPrompt ? " game-focus-overlay--bottom" : ""}`}>
    <div className="game-focus-top">
      <div className="game-focus-left"><button className="game-exit" onClick={props.onExit}>← 退出本局</button>
        {props.participant && <span className="game-hud-pill game-hud-participant" title={props.participant}>{props.participant}</span>}
        <span className="game-hud-pill">{mode.name}</span></div>
      <div className="game-round-progress" aria-label={`第 ${Math.min(props.round + 1, props.length)} 轮，共 ${props.length} 轮，已完成 ${props.correct + props.incorrect + props.rejected} 轮`}>
        <div className="game-round-progress__number">第<strong>{Math.min(props.round + 1, props.length)}</strong>轮 <span>/ {props.length}</span></div>
        <div className="game-round-dots" aria-hidden="true">{Array.from({ length: props.length }, (_, index) => <i key={index} className={index < props.correct + props.incorrect + props.rejected ? "is-complete" : !props.finished && index === props.round ? "is-active" : ""} />)}</div>
      </div>
      <div className="game-focus-summary">
        <div className="game-result-slot">
          {props.feedback && !props.finished && <div className={`game-table-feedback ${rejected ? "is-muted" : accepted ? "is-correct" : "is-wrong"}`} key={`${props.round}:${props.feedback}`} role="status" aria-atomic="true">
            <div className="game-feedback-choice"><span>识别</span><strong>{rejected ? "未确定" : props.selectedLabel ?? "—"}</strong></div>
            <span className="game-feedback-outcome"><svg className="game-feedback-symbol" aria-hidden="true" viewBox="0 0 24 24"><path pathLength="1" d={resultMark} /></svg>{rejected ? "进入下一轮" : accepted ? `正确${gained ? ` +${gained}` : ""}` : "错误"}</span>
          </div>}
        </div>
        <div className="game-focus-score" aria-label={`得分 ${props.score}，连胜 ${props.streak}`}>
          <div className="game-score-metric"><span><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m12 2 2.7 6.6 7.3.8-5.4 4.8 1.5 7.1-6.1-3.8-6.3 3.7 1.7-7-5.2-4.9 7-.7Z" /></svg>得分</span><strong>{props.score}</strong></div>
          <div className="game-score-metric"><span><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 21 5 3m.2 1c4-4 8 4 14 0l-1 9c-5 4-8-3-12-1M3 21h7" /></svg>连胜</span><strong>{props.streak}</strong></div>
        </div>
      </div>
    </div>
    {!props.finished && <div className={`game-focus-stage${props.countdown > 0 ? " is-countdown" : ""}${props.feedback ? " is-feedback" : ""}`} role="status" aria-hidden={Boolean(props.feedback)}>
      {props.countdown > 0 ? <div className="game-countdown" aria-label={`${props.countdown} 秒后开始，准备注视`}>
        <strong>{props.countdown}</strong><span>准备注视</span>
      </div> : props.status}
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

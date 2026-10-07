import type { RoundState } from "../teaching/operationRound";
interface OperationTrainingStatusProps {
  round?: RoundState;
  trial: number;
  preparing: boolean;
  countdown: number;
  running: boolean;
  target: string | null;
  recognizedTarget: string | null;
  result: string;
  error: string | null;
}

// Read existing training state only; this component never advances a trial.
export function OperationTrainingStatus({ trial, preparing, countdown, running, target, recognizedTarget, result, error, round }: OperationTrainingStatusProps) {
  const correct = result.startsWith("选择正确");
  const incorrect = result.startsWith("选择了");
  const rejected = result.includes("未能确定");
  const feedback = !running && !preparing && (correct || incorrect || rejected);
  const stage = round?.paused ? "已暂停" : round?.phase === "ROUND_COMPLETE" ? "本轮完成" : round?.phase === "INTER_TRIAL" ? "试次间隔" : countdown > 0 ? "目标提示" : preparing ? "准备中" : running ? "刺激中" : feedback ? "反馈中" : result.includes("暂停") ? "已暂停" : "准备";
  const tone = feedback ? correct ? "correct" : incorrect ? "incorrect" : "rejected" : "neutral";
  const displayTrial = round?.active || round?.phase === "ROUND_COMPLETE" ? round.index + 1 : preparing ? trial + 1 : trial;
  const message = round?.paused ? "训练已暂停" : round?.phase === "ROUND_COMPLETE" ? "本轮完成" : round?.phase === "INTER_TRIAL" ? "即将进入下一试次" : countdown > 0 ? `目标：${target ?? "—"} · ${countdown} 秒后开始`
    : preparing ? "正在检查显示"
    : running ? result.includes("显示不稳定") ? "请注视目标 · 显示不稳定" : result.includes("明显卡顿") ? "请注视目标 · 正在恢复分析窗口" : `请注视 ${target ?? "目标"}`
    : error ? error
    : feedback ? rejected ? "结果：未确定 / 拒识" : `识别结果：${recognizedTarget ?? "—"}`
    : result.includes("→") ? "准备就绪" : result;
  return <div className={`operation-stage-notice is-${tone}`} role="status" aria-live="polite" aria-atomic="true">
    <div className="operation-stage-notice__heading"><span>{displayTrial > 0 ? `试次 ${displayTrial}${round?.active || round?.phase === "ROUND_COMPLETE" ? " / 4" : ""}` : "操作训练"}</span><span className="operation-stage-notice__phase">{stage}</span></div>
    <div className="operation-stage-notice__message" key={`${stage}-${tone}`}><strong>{message}</strong>
      {feedback && !rejected && !round?.paused && round?.phase !== "INTER_TRIAL" && round?.phase !== "ROUND_COMPLETE" && <span className="operation-stage-notice__outcome">{correct ? "✓ 正确" : "✕ 错误"}</span>}
    </div>
    {round?.phase === "ROUND_COMPLETE" && <div className="operation-round-summary">正确 {round.correct} · 错误 {round.incorrect} · 拒识 {round.rejected}</div>}
  </div>;
}

import { useLayoutEffect, useRef } from "react";
import type { RealTrialAnalysis } from "../bci/signal/types";
// Fixed display scale for unbounded FBCCA scores; independent of other candidates.
const SCORE_DISPLAY_SCALE = 3;

export function DemoClassification({ analysis, labels, status }: { analysis: RealTrialAnalysis | null; labels: string[]; status: string }) {
  const matches = analysis?.matches ?? [];
  // Presentation only: preserve original candidate indices used by the classifier.
  const ranked = matches.map((match, index) => ({ ...match, index })).sort((a, b) => b.score - a.score);
  const listRef = useRef<HTMLDivElement>(null);
  const previousRows = useRef(new Map<HTMLElement, number>());
  const rowAnimations = useRef(new Map<HTMLElement, Animation>());
  // Retarget from the current visible position, including an unfinished transition.
  // Unchanged ranks do not restart animations or alter classifier ordering.
  useLayoutEffect(() => {
    const rows = Array.from(listRef.current?.children ?? []) as HTMLElement[];
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const nextRows = new Map<HTMLElement, number>();
    for (const row of rows) {
      const top = row.offsetTop;
      const previousTop = previousRows.current.get(row);
      const animation = rowAnimations.current.get(row);
      if (previousTop !== undefined && previousTop !== top) {
        const transform = getComputedStyle(row).transform;
        const translation = transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m42;
        animation?.cancel();
        rowAnimations.current.delete(row);
        const offset = previousTop + translation - top;
        if (!reducedMotion && Math.abs(offset) > 0.5) {
          rowAnimations.current.set(row, row.animate(
            [{ transform: `translateY(${offset}px)` }, { transform: "translateY(0)" }],
            { duration: 240, easing: "ease-out" },
          ));
        }
      }
      nextRows.set(row, top);
    }
    for (const [row, animation] of rowAnimations.current) {
      if (!nextRows.has(row)) { animation.cancel(); rowAnimations.current.delete(row); }
    }
    previousRows.current = nextRows;
  });
  useLayoutEffect(() => () => {
    for (const animation of rowAnimations.current.values()) animation.cancel();
    rowAnimations.current.clear();
  }, []);
  const bestScore = Math.max(0, ...ranked.map(match => Number.isFinite(match.score) ? match.score : 0));
  const invalid = analysis?.reason === "invalid_samples" || analysis?.reason === "transport_gap_suspected";
  const tone = !analysis ? "waiting" : analysis.rejected ? "rejected" : "accepted";
  const result = !analysis ? status : invalid ? "当前数据质量不足，无法分析" : analysis.rejected ? "当前结果：不确定 / 拒识" : `预测目标：${labels[analysis.candidateIndex!]} · ${matches[analysis.candidateIndex!]?.frequencyHz} Hz`;
  const reason = analysis?.reason === "unstable_vote" ? "等待连续稳定的匹配结果" : analysis?.rejected && !invalid ? "当前匹配强度未达到判定阈值" : null;
  return <article className="demo-cca" aria-label="真实 EEG CCA 匹配与分类结果">
    <h4>CCA 匹配（FBCCA）</h4>
    <small className="demo-cca-description">FBCCA 使用 O1 / O2 / P3 / P4 四通道联合匹配，条形按固定分数尺度显示匹配强度。</small>
    <div className="demo-cca-list" ref={listRef}>{ranked.map((match, rank) => {
      const displayScore = Number.isFinite(match.score) ? Math.max(0, match.score) : 0;
      const displayStrength = displayScore / (displayScore + SCORE_DISPLAY_SCALE);
      const best = rank === 0 && bestScore > 0;
      return <div className={`demo-cca-row${best ? " is-best" : ""}`} key={match.frequencyHz}>
        <span className="demo-cca-frequency"><span className="demo-cca-rank" aria-label={`第 ${rank + 1} 名`}>{rank + 1}</span>{match.frequencyHz} Hz</span>
        <div className="demo-cca-track" role="meter" aria-label={`${match.frequencyHz} Hz 匹配分数`} aria-valuemin={0} aria-valuemax={1} aria-valuenow={displayStrength} aria-valuetext={`匹配分数 ${match.score.toFixed(2)}`} title="按固定分数尺度显示，分数越高条形越长；不是分类正确概率"><div className="demo-cca-fill" style={{ transform: `scaleX(${displayStrength})` }} /></div>
        <small className="demo-cca-values">ρ = {match.correlation.toFixed(3)}<span>分数 = {match.score.toFixed(2)}</span></small>
      </div>;
    })}</div>
    <div className={`demo-classification-result is-${tone}`} role="status"><strong>{result}</strong>
      {ranked.length > 0 && <small>最高匹配：{ranked[0].frequencyHz} Hz</small>}
      {reason && <small>{reason}</small>}
    </div>
  </article>;
}

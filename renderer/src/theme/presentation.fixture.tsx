/** Isolated visual/performance fixture. Never imported by the application. */
import { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { StimulusTable } from "../components/StimulusTable";
import { GameTableHud } from "../components/GameTableHud";
import { gameStimulusTemplateForMode } from "../game/stimulusTemplate";
import { PRESENTATION_VERSION, applyPresentation, type PresentationVersion, type CardSetVersion } from "./presentation";
import { CURRENT_RASTER_QUALITY, type RasterQuality } from "../bci/stimulus/renderBudget";
import type { StimulusFrameStats } from "../bci/stimulus/types";
import type { ResponsiveStimulusGeometrySnapshot } from "../bci/stimulus/geometry";
import type { GameMode } from "../game/engine";

type Configuration = { mode: GameMode; active: boolean; version: PresentationVersion; cardSet?: CardSetVersion; appearance?: "card" | "card-face"; targetSize?: "standard" | "game-comfortable-v1" | "game-card-face-v2" | "game-open-v3" | "game-open-v4"; rasterQuality: RasterQuality; length: number; round: number; countdown: number; status?: string; feedback?: "correct" | "incorrect" | "rejected" | null; score?: number; streak?: number };
declare global {
  interface Window {
    presentationFixture: {
      configure: (next: Partial<Configuration>) => void;
      snapshot: () => { configuration: Configuration; stats: StimulusFrameStats | null; geometry: ResponsiveStimulusGeometrySnapshot | null; firstFrame: number | null; faults: number; resizeFaults: number };
    };
  }
}
applyPresentation(PRESENTATION_VERSION);
function Fixture() {
  const [configuration, configure] = useState<Configuration>({ mode: "simple", active: false, version: PRESENTATION_VERSION, rasterQuality: CURRENT_RASTER_QUALITY, length: 10, round: 0, countdown: 0 });
  const frameVersion = useRef(configuration.version);
  if (!configuration.active) frameVersion.current = configuration.version;
  applyPresentation(frameVersion.current);
  const template = useMemo(() => gameStimulusTemplateForMode(configuration.mode), [configuration.mode]);
  const state = useRef<{ stats: StimulusFrameStats | null; geometry: ResponsiveStimulusGeometrySnapshot | null; firstFrame: number | null; faults: number; resizeFaults: number }>({ stats: null, geometry: null, firstFrame: null, faults: 0, resizeFaults: 0 });
  window.presentationFixture = {
    configure: next => { if (next.active) { state.current.stats = null; state.current.firstFrame = null; state.current.faults = 0; } configure(previous => ({ ...previous, ...next })); },
    snapshot: () => ({ configuration, ...state.current }),
  };
  return <main className="shell shell--game"><section className="dashboard"><section className="game-workspace game-focus game-live">
    <article className="experiment-card table-only game-table-card"><div className="game-table-frame" data-game-size={configuration.targetSize} data-presentation={frameVersion.current}>
      <StimulusTable surface="game" targetAppearance={configuration.appearance} stimulusFootprint={configuration.appearance === "card-face" ? "card" : "seat"} targetSize={configuration.targetSize} selectedTargetIndex={configuration.feedback && configuration.feedback !== "rejected" ? configuration.feedback === "correct" ? 1 : 0 : null} selectedTargetCorrect={configuration.feedback === "correct"} active={configuration.active} targets={template.targets} presentationVersion={configuration.version} cardSetVersion={configuration.cardSet} rasterQuality={configuration.rasterQuality}
        referenceX={template.referenceX} referenceY={template.referenceY} referenceLabel="9♠" referenceTag="参考牌" showReference refreshRateHz={60}
        onFirstFrame={timestamp => { state.current.firstFrame = timestamp; }}
        onGeometryChange={geometry => { state.current.geometry = geometry; }}
        onFrameStats={stats => { state.current.stats = stats; }} onTimingStats={stats => { state.current.stats = stats; }}
        onResizeWhileActive={() => { state.current.resizeFaults++; }}
        onTimingFault={() => { state.current.faults++; }} onTimingDisruption={() => {}} />
      <GameTableHud bottomPrompt={configuration.targetSize === "game-open-v3" || configuration.targetSize === "game-open-v4"} mode={configuration.mode} round={configuration.round} length={configuration.length} participant="模拟测试同学" score={configuration.score ?? 300} streak={configuration.streak ?? 3}
        status={configuration.status ?? (configuration.active ? "刺激中 · 请注视所选牌" : "观察参考牌 · 找到目标")} countdown={configuration.countdown} feedback={configuration.feedback === "rejected" ? "本轮未确定 / 拒识，进入下一轮" : configuration.feedback === "correct" ? "EEG 选择：Q♥ · 正确，+100" : configuration.feedback === "incorrect" ? "EEG 选择：7♣ · 选择错误，正确答案是 Q♥" : null} selectedLabel={configuration.feedback === "correct" ? template.targets[1].label : configuration.feedback === "incorrect" ? template.targets[0].label : null}
        correct={configuration.round} incorrect={0} rejected={0} finished={false} restSeconds={0}
        onExit={() => {}} onReplay={() => {}} onNextMode={() => {}} />
    </div></article>
  </section></section></main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);

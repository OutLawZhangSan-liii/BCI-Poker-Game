import { DIFFICULT1_TARGETS, DIFFICULT2_DEMO_TARGETS, SIMPLE_STIMULUS_GEOMETRY, SIMPLE_TARGETS, type StimulusTarget } from "../bci/stimulus/types";
import type { GameMode } from "./engine";

/** Authoritative layout used by both idle previews and formal game rounds. */
export interface GameStimulusTemplate {
  mode: GameMode;
  layout: "simple-2" | "difficult1-4" | "difficult2-demo-6";
  referenceX: number;
  referenceY: number;
  targets: StimulusTarget[];
}

export function gameStimulusTemplateForMode(mode: GameMode): GameStimulusTemplate {
  const sourceTargets = mode === "simple" ? SIMPLE_TARGETS : mode === "difficult1" ? DIFFICULT1_TARGETS : DIFFICULT2_DEMO_TARGETS;
  return {
    mode,
    layout: mode === "simple" ? "simple-2" : mode === "difficult1" ? "difficult1-4" : "difficult2-demo-6",
    referenceX: mode === "difficult2" ? 0.11 : 0.5,
    referenceY: mode === "simple" ? SIMPLE_STIMULUS_GEOMETRY.referenceY : mode === "difficult2" ? 0.38 : 0.52,
    targets: sourceTargets.map((target) => ({ ...target, x: target.x - (mode === "difficult2" ? 0.045 : 0) })),
  };
}

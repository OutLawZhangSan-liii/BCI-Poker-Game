import type { GameMode } from "./engine";

export const GAME_PRESENTATION = {
  simple: { name: "简单", count: 2, observationMs: 2000, rule: "选择比中央参考牌大的候选牌；若有多张符合，选择最接近的一张。", next: "difficult1", nextLabel: "进入进阶" },
  difficult1: { name: "进阶", count: 4, observationMs: 2500, rule: "选择大于中央参考牌且最接近它的候选牌。", next: "difficult2", nextLabel: "挑战困难" },
  difficult2: { name: "困难", count: 6, observationMs: 2500, rule: "在六张候选牌中，选择大于中央参考牌且最接近它的一张。", next: null, nextLabel: "返回设置" },
} satisfies Record<GameMode, { name: string; count: number; observationMs: number; rule: string; next: GameMode | null; nextLabel: string }>;

export const GAME_COUNTDOWN_SECONDS = 3;
export const GAME_FEEDBACK_MS = 1200;

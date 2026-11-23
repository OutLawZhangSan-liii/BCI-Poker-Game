import type { RasterQuality } from "../bci/stimulus/renderBudget";
/** Presentation colors only: never used by stimulus modulation or signal processing. */
export const PRESENTATION_VERSION = "crayon-paper-v1" as const;
export const CARD_SET_VERSION = "crayon-deck-v4" as const;
export const GAME_SIZE_PROFILE = "game-open-v4" as const;
export function challengeTargetSize(stimulus: string): "standard" | "game-comfortable-v1" | "game-card-face-v2" | "game-open-v3" | typeof GAME_SIZE_PROFILE {
  const value = JSON.parse(stimulus).gameSizeProfile ?? "standard";
  if (value === "standard" || value === "game-comfortable-v1" || value === "game-card-face-v2" || value === "game-open-v3" || value === GAME_SIZE_PROFILE) return value;
  throw new Error("此挑战的牌面尺寸版本不受当前程序支持");
}
export function challengeAppearance(stimulus: string): "card" | "card-face" {
  const value = JSON.parse(stimulus).appearance ?? "card";
  if (value === "card" || value === "card-face") return value;
  throw new Error("此挑战的刺激形式不受当前程序支持");
}
export type PresentationVersion = typeof PRESENTATION_VERSION | "warm-paper-v1" | "legacy-green-v1";
export type CardSetVersion = typeof CARD_SET_VERSION | "crayon-deck-v3" | "crayon-deck-v2" | "crayon-deck-v1" | "classic-deck-v1";
export const WARM_PAPER = {
  background: "#F7F5F1", panel: "#FFFEFC", ink: "#202126", muted: "#73716D",
  border: "#E2DED7", accent: "#C83E2D", raised: "#F0EDE7", accentSoft: "#FAEBE7",
} as const;
export const WARM_PAPER_CSS = {
  "--theme-bg": WARM_PAPER.background, "--theme-panel": WARM_PAPER.panel,
  "--theme-ink": WARM_PAPER.ink, "--theme-muted": WARM_PAPER.muted,
  "--theme-border": WARM_PAPER.border, "--theme-accent": WARM_PAPER.accent,
  "--theme-raised": WARM_PAPER.raised, "--theme-accent-soft": WARM_PAPER.accentSoft,
};
export const CRAYON_PAPER = {
  background: "#FAFBFE", panel: "#FFFEFC", ink: "#17356B", muted: "#64748B",
  border: "#A9B8D0", accent: "#E62546", raised: "#F0F4FA", accentSoft: "#FFF0F3",
} as const;
export function presentationPalette(version: PresentationVersion) {
  return version === "crayon-paper-v1" ? CRAYON_PAPER : WARM_PAPER;
}
/** Shared CSS/native compositing prevents an undimmed native caption rectangle. */
export function modalBackdrop(version: PresentationVersion) {
  const ink = presentationPalette(version).ink;
  const rgb = [1, 3, 5].map(i => parseInt(ink.slice(i, i + 2), 16));
  const alpha = version === "crayon-paper-v1" ? .16 : .26;
  return { rgb, alpha, css: `rgba(${rgb.join(",")},${alpha})` };
}
export function titleBarAppearance(version: PresentationVersion, dimmed: boolean) {
  const palette = presentationPalette(version), backdrop = modalBackdrop(version);
  const color = dimmed ? "#" + [1, 3, 5].map((offset, i) => Math.round(
    parseInt(palette.background.slice(offset, offset + 2), 16) * (1 - backdrop.alpha) + backdrop.rgb[i] * backdrop.alpha,
  ).toString(16).padStart(2, "0")).join("").toUpperCase() : palette.background;
  return { color, symbolColor: palette.ink };
}
export function applyPresentation(version: PresentationVersion) {
  const p = presentationPalette(version);
  // UI interaction colors are separate from the saved Canvas presentation palette.
  const uiAccent = version === "crayon-paper-v1" ? p.ink : p.accent;
  const uiAccentSoft = version === "crayon-paper-v1" ? "#EAF0F8" : p.accentSoft;
  for (const [key, value] of Object.entries({ bg:p.background, panel:p.panel, ink:p.ink, muted:p.muted, border:p.border, accent:uiAccent, raised:p.raised, "accent-soft":uiAccentSoft })) {
    document.documentElement.style.setProperty(`--theme-${key}`, value);
  }
  document.documentElement.style.setProperty("--modal-backdrop", modalBackdrop(version).css);
  document.documentElement.dataset.presentation = version;
}
export function cardSetForPresentation(version: PresentationVersion): CardSetVersion {
  return version === "crayon-paper-v1" ? CARD_SET_VERSION : "classic-deck-v1";
}
export function cardFacePath(label: string, version: PresentationVersion, cardSet: CardSetVersion = cardSetForPresentation(version)): string {
  const match = /^(A|[2-9]|10|J|Q|K)([♦♣♥♠])$/u.exec(label);
  if (!match) throw new Error("无效的扑克牌标识");
  if (version === "crayon-paper-v1" ? !["crayon-deck-v1", "crayon-deck-v2", "crayon-deck-v3", "crayon-deck-v4"].includes(cardSet) : cardSet !== "classic-deck-v1") throw new Error("牌组版本与呈现版本不一致");
  const suit = ["♦", "♣", "♥", "♠"].indexOf(match[2]) + 1;
  const directory = version !== "crayon-paper-v1" ? "" : cardSet === "crayon-deck-v4" ? "uniform-v4/" : cardSet === "crayon-deck-v3" ? "borderless-v3/" : cardSet === "crayon-deck-v2" && !["J", "Q", "K"].includes(match[1]) ? "web-pips-v2/" : "crayon-v1/";
  return `cards/${directory}${match[1]}-${suit}.png`;
}
export function cardBackPath(version: PresentationVersion, cardSet: CardSetVersion = cardSetForPresentation(version)): string {
  cardFacePath("A♠", version, cardSet);
  if (cardSet === "crayon-deck-v4") return "cards/uniform-v4/card-back.png";
  if (cardSet === "crayon-deck-v3") return "cards/borderless-v3/card-back.png";
  return version === "crayon-paper-v1" ? "cards/crayon-v1/card-back.png" : version === "legacy-green-v1" ? "cards/card-back.svg" : "cards/card-back-warm.svg";
}
export function challengePresentation(stimulus: string): PresentationVersion {
  const data = JSON.parse(stimulus);
  if (data.presentationVersion === undefined) return "legacy-green-v1";
  if ([PRESENTATION_VERSION, "warm-paper-v1", "legacy-green-v1"].includes(data.presentationVersion)) return data.presentationVersion;
  throw new Error("此挑战的呈现版本不受当前程序支持");
}
export function challengeCardSet(stimulus: string): CardSetVersion {
  const data = JSON.parse(stimulus), version = challengePresentation(stimulus);
  // A missing field predates the pip update, so it must never select new art.
  const saved = data.cardSetVersion ?? (version === "crayon-paper-v1" ? "crayon-deck-v1" : "classic-deck-v1");
  cardFacePath("A♠", version, saved);
  return saved;
}
export function challengeRasterQuality(stimulus: string): RasterQuality {
  const value = JSON.parse(stimulus).rasterQuality ?? "balanced-v1";
  if (value === "balanced-v1" || value === "sharp-v1") return value;
  throw new Error("此挑战的绘制清晰度版本不受当前程序支持");
}
/** Known saved presentation/size profiles are replayed explicitly; all other settings must match. */
export function canResumePresentation(saved: {ruleVersion: string; classifier: string; stimulus: string}, current: typeof saved): boolean {
  if (saved.ruleVersion !== current.ruleVersion || saved.classifier !== current.classifier) return false;
  try {
    challengePresentation(saved.stimulus);
    challengeAppearance(saved.stimulus); challengeAppearance(current.stimulus);
    challengeCardSet(saved.stimulus); challengeCardSet(current.stimulus);
    challengeRasterQuality(saved.stimulus);
    challengeTargetSize(saved.stimulus); challengeTargetSize(current.stimulus);
    const left = JSON.parse(saved.stimulus), right = JSON.parse(current.stimulus);
    delete left.presentationVersion; delete right.presentationVersion;
    delete left.rasterQuality; delete right.rasterQuality;
    delete left.cardSetVersion; delete right.cardSetVersion;
    delete left.gameSizeProfile; delete right.gameSizeProfile;
    delete left.appearance; delete right.appearance;
    return JSON.stringify(left) === JSON.stringify(right);
  } catch { return false; }
}

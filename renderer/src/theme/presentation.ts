/** Presentation colors only: never used by stimulus modulation or signal processing. */
export const PRESENTATION_VERSION = "warm-paper-v1" as const;
export type PresentationVersion = typeof PRESENTATION_VERSION | "legacy-green-v1";
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
export function challengePresentation(stimulus: string): PresentationVersion {
  const data = JSON.parse(stimulus);
  if (data.presentationVersion === undefined) return "legacy-green-v1";
  if (data.presentationVersion === PRESENTATION_VERSION || data.presentationVersion === "legacy-green-v1") return data.presentationVersion;
  throw new Error("此挑战的呈现版本不受当前程序支持");
}
/** Only the known presentation difference may be replayed; classifier and geometry must still match. */
export function canResumePresentation(saved: {ruleVersion: string; classifier: string; stimulus: string}, current: typeof saved): boolean {
  if (saved.ruleVersion !== current.ruleVersion || saved.classifier !== current.classifier) return false;
  try {
    challengePresentation(saved.stimulus);
    const left = JSON.parse(saved.stimulus), right = JSON.parse(current.stimulus);
    delete left.presentationVersion; delete right.presentationVersion;
    return JSON.stringify(left) === JSON.stringify(right);
  } catch { return false; }
}

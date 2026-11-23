/** Limited renderer-to-native appearance payload; no arbitrary window options. */
export interface WindowAppearance { color: string; symbolColor: string; }
export function validateWindowAppearance(value: unknown): WindowAppearance {
  if (!value || typeof value !== "object") throw new Error("无效的窗口颜色");
  const { color, symbolColor } = value as Partial<WindowAppearance>;
  const valid = (color: unknown): color is string => typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color);
  if (!valid(color) || !valid(symbolColor)) throw new Error("无效的窗口颜色");
  return { color, symbolColor };
}

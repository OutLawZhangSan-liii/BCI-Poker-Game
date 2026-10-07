import { useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type StatusTone = "neutral" | "success" | "warning" | "danger";

export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  const id = useId();
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const show = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 256)), top: rect.bottom + 100 < window.innerHeight ? rect.bottom + 6 : Math.max(8, rect.top - 96) });
  };
  return <span className="ui-tooltip" tabIndex={0} aria-describedby={position ? id : undefined} onMouseEnter={(event) => show(event.currentTarget)} onMouseLeave={() => setPosition(null)}
    onFocus={(event) => show(event.currentTarget)} onBlur={() => setPosition(null)} onKeyDown={(event) => { if (event.key === "Escape") setPosition(null); }}>{children}
    {position && createPortal(<span id={id} className="ui-tooltip-content" role="tooltip" style={position}>{text}</span>, document.body)}
  </span>;
}

interface StatusBadgeProps {
  label?: string;
  value: string;
  tone?: StatusTone;
  hint?: string;
}

export function StatusBadge({ label, value, tone = "neutral", hint }: StatusBadgeProps) {
  const badge = <span className={`status-badge status-badge--${tone}`} aria-label={label ? `${label}：${value}` : value}>
    {label && <span className="status-badge__label">{label}</span>}
    <span className="status-badge__value">{value}</span>
    {hint && <span aria-hidden="true">ⓘ</span>}
  </span>;
  return hint ? <Tooltip text={hint}>{badge}</Tooltip> : badge;
}

import { useCallback, useEffect, useId, useRef, useState } from "react";
interface Choice {
  label: string;
  selected: boolean;
  choose: () => void;
}
interface Row { key: string; label: string; disabled?: boolean; choices: Choice[] }

export function foldChoices<T>(values: readonly T[], current: T, label: (value: T) => string, select: (value: T) => void): Choice[] {
  return values.map(value => ({ label: label(value), selected: value === current, choose: () => select(value) }));
}

export function SettingsFold({ scope, rows }: { scope: string; rows: Row[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);
  const id = useId();
  const cancelPendingClose = useCallback(() => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  const dismiss = useCallback(() => { cancelPendingClose(); setOpen(null); }, [cancelPendingClose]);
  useEffect(() => cancelPendingClose, [cancelPendingClose]);
  const openDisabled = rows.some(row => row.key === open && row.disabled);
  useEffect(() => { if (openDisabled) dismiss(); }, [openDisabled, dismiss]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) dismiss(); };
    document.addEventListener("pointerdown", outside); window.addEventListener("resize", dismiss);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", dismiss); };
  }, [open, dismiss]);
  const close = (key: string) => {
    dismiss();
    root.current?.querySelector<HTMLButtonElement>(`[data-fold-trigger="${key}"]`)?.focus({ preventScroll: true });
  };
  const closeAfterSelection = (key: string) => {
    cancelPendingClose();
    // Keep the updated choice visible before the CSS closing transition begins.
    closeTimer.current = window.setTimeout(() => close(key), 400);
  };
  return <div className="game-settings-fold" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) dismiss();
  }} onKeyDown={event => {
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(open); }
  }}>
    <div className="game-settings-fold__paper">
      {rows.map(({ key, label, disabled, choices }) => {
        const expanded = open === key;
        return <div className={`game-settings-fold__group ${expanded ? "is-open" : ""}`} role="group" aria-label={`${scope}${label}`} key={key}>
          <button type="button" className="secondary game-settings-fold__trigger" data-fold-trigger={key} disabled={disabled}
            aria-label={`选择${scope}${label}`} aria-expanded={expanded} aria-controls={`${id}-${key}`}
            onClick={() => { cancelPendingClose(); setOpen(expanded ? null : key); }} onKeyDown={event => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); cancelPendingClose(); setOpen(key);
                requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>(`[data-fold-options="${key}"] button`)?.focus({ preventScroll: true })); }
            }}>
            <span className="game-control-label">{label}</span>
            <strong>{choices.find(choice => choice.selected)?.label}</strong>
            <svg aria-hidden="true" viewBox="0 0 20 20"><path d="m7.5 5 5 5-5 5" /></svg>
          </button>
          <div className={`game-settings-fold__reveal ${expanded ? "is-open" : ""}`} id={`${id}-${key}`} aria-hidden={!expanded} inert={!expanded}>
            <div className="game-settings-fold__clip"><div className="game-settings-fold__options" data-fold-options={key}>
              {choices.map(choice => <button type="button" className="secondary paper-choice" key={choice.label}
                disabled={disabled} tabIndex={expanded ? 0 : -1} aria-pressed={choice.selected}
                onClick={() => { choice.choose(); closeAfterSelection(key); }}>{choice.label}</button>)}
            </div></div>
          </div>
        </div>;
      })}
    </div>
  </div>;
}

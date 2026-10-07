import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Option<T extends string> { value: T; label: string; prefix?: string; suffix?: string }
interface Props<T extends string> {
  value: T; options: Option<T>[]; onChange: (value: T) => void;
  label: string; ariaLabel: string; menuLabel: string;
  theme: "course" | "dark"; disabled?: boolean; className?: string; displayValue?: string; compact?: boolean;
}

export function ThemedDropdown<T extends string>({ value, options, onChange, label, ariaLabel, menuLabel,
  theme, disabled = false, className = "", displayValue, compact = false }: Props<T>) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 320 });
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const items = useRef<Array<HTMLButtonElement | null>>([]);
  const id = useId();
  const selected = Math.max(0, options.findIndex(option => option.value === value));
  const close = (restoreFocus = false) => { setOpen(false); if (restoreFocus) trigger.current?.focus(); };
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const bounds = trigger.current.getBoundingClientRect();
    const below = innerHeight - bounds.bottom - 14, above = bounds.top - 14;
    const height = Math.min(options.length * (compact ? 32 : 44) + (compact ? 8 : 12), 340);
    const useAbove = below < Math.min(height, 180) && above > below;
    const maxHeight = Math.max(44, Math.min(height, useAbove ? above : below));
    setPosition({ left: Math.max(8, Math.min(bounds.left, innerWidth - bounds.width - 8)),
      top: useAbove ? bounds.top - maxHeight - 6 : bounds.bottom + 6,
      width: Math.min(bounds.width, innerWidth - 16), maxHeight });
    items.current[selected]?.focus({ preventScroll: true });
    items.current[selected]?.scrollIntoView({ block: "nearest" });
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    const resize = () => setOpen(false);
    const scroll = (event: Event) => { if (!menu.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside); window.addEventListener("resize", resize);
    document.addEventListener("scroll", scroll, true);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", resize); document.removeEventListener("scroll", scroll, true); };
  }, [open]);
  return <div ref={root} className={`themed-dropdown themed-dropdown--${theme} ${className}`} onBlur={event => {
    if (!root.current?.contains(event.relatedTarget as Node) && !menu.current?.contains(event.relatedTarget as Node)) close();
  }}>
    <span className="themed-dropdown__label">{label}</span>
    <button ref={trigger} type="button" className="themed-dropdown__trigger" disabled={disabled}
      aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setOpen(previous => !previous)} onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); }
        if (event.key === "Escape") close(true);
      }}>
      <span className="themed-dropdown__value">{displayValue ?? options[selected]?.label}</span>
      <svg className="themed-dropdown__chevron" aria-hidden="true" viewBox="0 0 20 20" width="20" height="20"><path d="m5 7.5 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {open && createPortal(<div ref={menu} id={id} role="listbox" aria-label={menuLabel}
      className={`themed-dropdown__menu themed-dropdown--${theme} ${compact ? "themed-dropdown__menu--compact" : ""}`} style={position} onKeyDown={event => {
        if (event.key === "Tab") { close(true); return; }
        const index = items.current.indexOf(document.activeElement as HTMLButtonElement);
        let next = index;
        if (event.key === "ArrowDown") next = (index + 1) % options.length;
        else if (event.key === "ArrowUp") next = (index - 1 + options.length) % options.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = options.length - 1;
        else if (event.key === "Escape") { event.preventDefault(); close(true); return; }
        else return;
        event.preventDefault(); items.current[next]?.focus();
      }}>
      {options.map((option, index) => <button key={option.value} ref={element => { items.current[index] = element; }}
        type="button" role="option" aria-selected={option.value === value} tabIndex={-1}
        className="themed-dropdown__option" onClick={() => { onChange(option.value); close(true); }}>
        {option.prefix && <span className="themed-dropdown__prefix">{option.prefix}</span>}
        <span className="themed-dropdown__option-label">{option.label}</span>
        <span className="themed-dropdown__check" aria-hidden="true">{option.value === value ? "✓" : option.suffix ?? ""}</span>
      </button>)}
    </div>, document.body)}
  </div>;
}

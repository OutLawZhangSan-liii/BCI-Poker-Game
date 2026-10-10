import { useEffect, useRef, useState } from "react";
import { IntroNeuron } from "./IntroNeuron";
import { BrandWordmark } from "./BrandWordmark";
import "./IntroFlipAnimation.css";

export const FORCE_INTRO = false;
const SESSION_KEY = "shenyoo_intro_played";
const FRAMES = ["01_standby.png"]
  .map(name => `${import.meta.env.BASE_URL}assets/intro/${name}`);

export function shouldPlayIntro() {
  if (import.meta.env.DEV && FORCE_INTRO) return true;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  try { return sessionStorage.getItem(SESSION_KEY) !== "true"; } catch { return true; }
}

let preloaded: Promise<HTMLImageElement[]> | undefined;
function preloadFrames() {
  const sources = [...FRAMES, `${import.meta.env.BASE_URL}assets/branding/neuron-icon.png`, `${import.meta.env.BASE_URL}assets/branding/shoujin-wordmark.svg`];
  return preloaded ??= Promise.all(sources.map(src => new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => { image.decode().then(() => resolve(image), reject); };
    image.onerror = () => reject(new Error("开场素材加载失败"));
    image.src = src;
  })));
}

export function IntroFlipAnimation({ onReveal, onComplete }: { onReveal: () => void; onComplete: () => void }) {
  const [running, setRunning] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [exitMs, setExitMs] = useState(250);
  const exiting = useRef(false), revealed = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacks = useRef({ onReveal, onComplete }); callbacks.current = { onReveal, onComplete };
  const reveal = () => {
    if (revealed.current) return;
    revealed.current = true; callbacks.current.onReveal();
  };
  const leave = (duration = 200) => {
    if (exiting.current) return;
    exiting.current = true;
    reveal(); setExitMs(duration); setLeaving(true);
    timer.current = setTimeout(() => {
      try { sessionStorage.setItem(SESSION_KEY, "true"); } catch { /* Storage can be disabled in private sessions. */ }
      callbacks.current.onComplete();
    }, duration);
  };
  const actions = useRef({ reveal, leave }); actions.current = { reveal, leave };
  useEffect(() => {
    let cancelled = false, frame = 0;
    let finishTimer: ReturnType<typeof setTimeout> | null = null;
    preloadFrames().then(() => {
      if (cancelled || exiting.current) return;
      // Resolve the real page's initial layout/paint before rotating the card.
      actions.current.reveal();
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          if (cancelled || exiting.current) return;
          setRunning(true);
          // Turn ends at 2750 ms; the logo draws alongside the 1000 ms title reveal.
          // Both hold together for 500 ms before transitioning into the real table.
          finishTimer = setTimeout(() => actions.current.leave(300), 4250);
        });
      });
    }).catch(() => { if (!cancelled) actions.current.leave(); });
    const key = (event: KeyboardEvent) => {
      if (event.code === "Space" || event.key === "Enter" || event.key === "Escape") {
        event.preventDefault(); actions.current.leave();
      }
    };
    window.addEventListener("keydown", key);
    return () => { cancelled = true; cancelAnimationFrame(frame); window.removeEventListener("keydown", key); if (finishTimer !== null) clearTimeout(finishTimer); if (timer.current !== null) clearTimeout(timer.current); };
  }, []);
  return <div className={`intro-flip ${running ? "intro-flip--running" : ""} ${leaving ? "intro-flip--leaving" : ""}`} style={{ transitionDuration: `${exitMs}ms` }}
    aria-label="神工 · 神游开场动画" onClick={() => leave()}>
    <div className="intro-flip__artwork" aria-hidden="true">
      <div className="intro-flip__scene">
        <img className="intro-flip__background" src={FRAMES[0]} alt="" draggable={false} />
        <div className="intro-flip__title-position">
          <IntroNeuron />
          <span className="intro-flip__title"><BrandWordmark /></span>
        </div>
        <div className="intro-flip__card-position">
          <div className="intro-flip__card">
            <div className="intro-flip__face" style={{ backgroundImage: `url("${FRAMES[0]}")` }} />
            <div className="intro-flip__face intro-flip__face--back" style={{ backgroundImage: `url("${FRAMES[0]}")` }} />
          </div>
        </div>
      </div>
    </div>
    <span className="intro-flip__skip">点击或按 Enter / Space / Esc 跳过</span>
  </div>;
}

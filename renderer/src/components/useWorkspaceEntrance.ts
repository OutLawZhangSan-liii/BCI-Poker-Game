import { useLayoutEffect, type RefObject } from "react";

export function useWorkspaceEntrance(root: RefObject<HTMLElement | null>, key: string, selector: string, enabled: boolean) {
  useLayoutEffect(() => {
    if (!enabled || document.hidden || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const nodes = Array.from(root.current?.querySelectorAll<HTMLElement>(selector) ?? []).filter(node => node.getClientRects().length);
    const animations = nodes.map(node => node.animate([{ opacity: .65 }, { opacity: 1 }], { duration: 200, easing: "cubic-bezier(.2,.7,.2,1)" }));
    return () => animations.forEach(animation => animation.cancel());
  }, [root, key, selector, enabled]);
}

"use client";

import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";

const RM = "(prefers-reduced-motion: reduce)";
function subscribeRM(cb: () => void) {
  const m = window.matchMedia(RM);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}
export function useReducedMotion() {
  return useSyncExternalStore(subscribeRM, () => window.matchMedia(RM).matches, () => false);
}

/** True while the element is on screen and the tab is visible. */
export function useOnScreen(ref: RefObject<Element | null>, threshold = 0.25) {
  const [inView, setInView] = useState(false);
  const [tabVisible, setTabVisible] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold });
    io.observe(el);
    const onVis = () => setTabVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => { io.disconnect(); document.removeEventListener("visibilitychange", onVis); };
  }, [ref, threshold]);
  return inView && tabVisible;
}

/**
 * Steps through phases 0..delays.length. Each phase waits delays[phase] ms.
 * With loop, the phase after the last wraps to 0. Paused while !playing.
 * Reduced motion jumps straight to `final`.
 */
export function useTimeline(delays: readonly number[], { playing, loop, final }: { playing: boolean; loop: boolean; final: number }) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (reduced || !playing) return;
    if (phase >= delays.length && !loop) return;
    const t = setTimeout(() => setPhase((p) => (p >= delays.length ? 0 : p + 1)), delays[phase] ?? 0);
    return () => clearTimeout(t);
  }, [phase, playing, reduced, loop, delays]);
  return reduced ? final : phase;
}

/**
 * Types `text` while `run`; the untyped rest is kept as transparent text so the
 * line never reflows (no layout shift) and screen readers get the full string.
 */
export function Typed({ text, run, speed = 26, ghostClass }: { text: string; run: boolean; speed?: number; ghostClass?: string }) {
  const reduced = useReducedMotion();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!run || reduced) return;
    let c = 0;
    const len = Array.from(text).length;
    const id = setInterval(() => {
      c += 1;
      setN(c);
      if (c >= len) clearInterval(id);
    }, speed);
    return () => { clearInterval(id); setN(0); };
  }, [run, reduced, text, speed]);
  const chars = Array.from(text);
  const shown = reduced ? chars.length : run ? n : 0;
  return (
    <>
      {chars.slice(0, shown).join("")}
      <span className={ghostClass} style={{ color: "transparent" }}>{chars.slice(shown).join("")}</span>
    </>
  );
}

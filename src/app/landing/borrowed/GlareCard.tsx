"use client";

import { useRef, type ReactNode } from "react";
import s from "./GlareCard.module.css";

/**
 * Card that tilts a few degrees toward a fine pointer and catches a warm
 * light: a soft glare plus a faint foil sheen that slide with the cursor.
 * Everything moves through CSS variables that feed `transform` only; the
 * layers fade in with `opacity`. Touch and reduced-motion users get the flat
 * card (no tilt, no glare).
 */
export function GlareCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef(0);

  const enabled = () =>
    typeof window !== "undefined" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || !enabled()) return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width; // 0..1
    const py = (e.clientY - rect.top) / rect.height;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      el.style.setProperty("--gc-rx", `${((0.5 - py) * 7).toFixed(2)}deg`);
      el.style.setProperty("--gc-ry", `${((px - 0.5) * 9).toFixed(2)}deg`);
      el.style.setProperty("--gc-x", `${((px - 0.5) * 100).toFixed(1)}%`);
      el.style.setProperty("--gc-y", `${((py - 0.5) * 100).toFixed(1)}%`);
      el.dataset.active = "";
    });
  };

  const onLeave = () => {
    const el = ref.current;
    if (!el) return;
    cancelAnimationFrame(frame.current);
    el.style.setProperty("--gc-rx", "0deg");
    el.style.setProperty("--gc-ry", "0deg");
    delete el.dataset.active;
  };

  return (
    <div ref={ref} className={s.stage} onPointerMove={onMove} onPointerLeave={onLeave}>
      <div className={`${s.card} ${className}`}>
        {children}
        <span className={s.foil} aria-hidden="true" />
        <span className={s.glare} aria-hidden="true" />
      </div>
    </div>
  );
}

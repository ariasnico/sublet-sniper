"use client";
import { useEffect, useRef, useState } from "react";

/** Count up to a value with an ease-out curve. Jumps straight there with reduced motion. */
function useCountUp(value: number, ms = 900) {
  const [v, setV] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { from.current = value; setV(value); return; }
    const t0 = performance.now(); let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - p, 3);
      setV(start + (value - start) * e);
      if (p < 1) raf = requestAnimationFrame(tick); else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); from.current = value; };
  }, [value, ms]);
  return v;
}

function Stat({ label, value, format, tone }: { label: string; value: number; format: (n: number) => string; tone?: string }) {
  const v = useCountUp(value);
  const [bump, setBump] = useState(false);
  const prev = useRef(value);
  useEffect(() => {
    if (value > prev.current) { setBump(true); const id = setTimeout(() => setBump(false), 600); prev.current = value; return () => clearTimeout(id); }
    prev.current = value;
  }, [value]);
  return <div className={`stat ${tone ?? ""}${bump ? " bump" : ""}`}><b>{format(v)}</b><span>{label}</span></div>;
}

export interface StatValues { scanned: number; blocked: number; emails: number; minutes: number; protectedUsd: number }

export function Stats({ v }: { v: StatValues }) {
  const int = (n: number) => Math.round(n).toLocaleString("en-US");
  const hrs = (n: number) => n < 60 ? `${Math.round(n)}m` : `${(n / 60).toFixed(1)}h`;
  const usd = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`;
  return (
    <div className="stats">
      <Stat label="time saved" value={v.minutes} format={hrs} tone="accent" />
      <Stat label="listings scanned" value={v.scanned} format={int} />
      <Stat label="scams blocked" value={v.blocked} format={int} tone="red" />
      <Stat label="money protected" value={v.protectedUsd} format={usd} tone="green" />
    </div>
  );
}

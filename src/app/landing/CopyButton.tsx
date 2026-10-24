"use client";
import { useEffect, useState } from "react";

/** Copies a snippet to the clipboard; announces the result to screen readers. */
export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1600);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button
      type="button"
      className={className}
      data-done={done || undefined}
      aria-live="polite"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setDone(true); } catch { /* clipboard unavailable: user can select the text */ }
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

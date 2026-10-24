"use client";

import { useEffect, useRef } from "react";
import s from "./RedFlagMarquee.module.css";

/**
 * Strip of the red flags the Scam X-ray looks for (each maps to a real check
 * in src/lib/scam.ts). Drifts on its own and can be grabbed with mouse or
 * finger: it follows the pointer and, on release, keeps the gesture's speed,
 * which decays back to the base drift. Hovering with a mouse slows it to a
 * stop so it can be read.
 *
 * Without JS a plain CSS marquee runs; with prefers-reduced-motion it is a
 * static wrapped list (duplicates hidden). Vertical gestures stay page scroll.
 */

const FLAGS = [
  "Zelle before a viewing",
  "Wire transfers",
  "Gift cards and crypto",
  "A “holding fee” to reserve it",
  "Owner out of the country",
  "Keys sent by mail",
  "No viewings, ever",
  "Photos copied from another listing",
  "Copy-pasted descriptions",
  "Upfront money over the California cap",
  "Credit checks through a stranger’s link",
  "Rent far below the SF median",
];

const BASE_SPEED = 28; // px/s
const MAX_FLING = 2400; // px/s

function Row({ hidden = false }: { hidden?: boolean }) {
  return (
    <ul data-row className={`${s.row} ${hidden ? s.dup : ""}`} aria-hidden={hidden || undefined}>
      {FLAGS.map((f) => (
        <li key={f}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <circle cx="8" cy="8" r="7" />
            <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" />
          </svg>
          {f}
        </li>
      ))}
    </ul>
  );
}

export function RedFlagMarquee() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const rows = track.querySelectorAll<HTMLElement>("[data-row]");
    if (rows.length < 2) return;
    track.classList.add(s.trackJs);

    // One lap = distance between the start of two consecutive copies.
    let W = rows[1].offsetLeft - rows[0].offsetLeft;
    const remeasure = () => { W = rows[1].offsetLeft - rows[0].offsetLeft; };
    window.addEventListener("resize", remeasure);

    let offset = 0;
    let vel = BASE_SPEED;
    let target = BASE_SPEED;
    let dragging = false;
    let start: { x: number; y: number; id: number } | null = null;
    let lastX = 0;
    let lastT = 0;
    let prev = performance.now();
    let visible = true;

    const paint = () => { track.style.transform = `translate3d(${-offset}px,0,0)`; };

    let raf = requestAnimationFrame(function frame(now) {
      const dt = Math.min((now - prev) / 1000, 0.05);
      prev = now;
      if (visible && !dragging && W > 0) {
        vel += (target - vel) * Math.min(1, dt * 2.4);
        offset = (((offset + vel * dt) % W) + W) % W;
        paint();
      }
      raf = requestAnimationFrame(frame);
    });

    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
    io.observe(viewport);

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      start = { x: e.clientX, y: e.clientY, id: e.pointerId };
      dragging = false;
    };
    const onMove = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!dragging) {
        if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { start = null; return; }
        if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
          dragging = true;
          viewport.setPointerCapture(e.pointerId);
          lastX = e.clientX;
          lastT = performance.now();
        }
        return;
      }
      const now = performance.now();
      const ddx = e.clientX - lastX;
      const ddt = Math.max(now - lastT, 1) / 1000;
      offset = (((offset - ddx) % W) + W) % W;
      paint();
      const inst = Math.max(-MAX_FLING, Math.min(MAX_FLING, -ddx / ddt));
      vel = vel * 0.25 + inst * 0.75;
      lastX = e.clientX;
      lastT = now;
    };
    const onUp = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      if (dragging && performance.now() - lastT > 120) vel = target;
      dragging = false;
      start = null;
      prev = performance.now();
    };
    const onEnter = () => { target = 0; };
    const onLeave = () => { target = BASE_SPEED; };

    viewport.addEventListener("pointerdown", onDown);
    viewport.addEventListener("pointermove", onMove);
    viewport.addEventListener("pointerup", onUp);
    viewport.addEventListener("pointercancel", onUp);
    viewport.addEventListener("mouseenter", onEnter);
    viewport.addEventListener("mouseleave", onLeave);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("resize", remeasure);
      viewport.removeEventListener("pointerdown", onDown);
      viewport.removeEventListener("pointermove", onMove);
      viewport.removeEventListener("pointerup", onUp);
      viewport.removeEventListener("pointercancel", onUp);
      viewport.removeEventListener("mouseenter", onEnter);
      viewport.removeEventListener("mouseleave", onLeave);
      track.classList.remove(s.trackJs);
      track.style.transform = "";
    };
  }, []);

  return (
    <section className={s.band} aria-labelledby="redflags-caption">
      <p id="redflags-caption" className={s.caption}>
        The Scam X-ray flags these before you ever reply.
      </p>
      <div ref={viewportRef} className={s.viewport}>
        <div ref={trackRef} className={s.track}>
          <Row />
          <Row hidden />
          <Row hidden />
          <Row hidden />
        </div>
      </div>
    </section>
  );
}

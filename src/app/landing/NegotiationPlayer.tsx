"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import s from "./NegotiationPlayer.module.css";

/** Line timings (seconds) for public/landing/negotiation.mp3 (ElevenLabs TTS, 0.5s gaps). */
const LINES = [
  { who: "Sniper", start: 0, end: 9.36, text: "Hi! This is Sniper, an AI assistant calling for Nicolás about your furnished one-bedroom near Caltrain. Is it still available from November first?" },
  { who: "Landlord", start: 9.86, end: 16.1, text: "It is. It’s $3,800, and I need a $7,600 Zelle deposit today to hold it." },
  { who: "Sniper", start: 16.6, end: 25.0, text: "Nicolás doesn’t send any payment before a viewing and a written sublease. Would you do $3,600 if he signs right after a video tour?" },
  { who: "Landlord", start: 25.5, end: 29.26, text: "Okay, $3,600 works. Monday after five?" },
  { who: "Sniper", start: 29.76, end: 32.56, text: "Monday 5:30 is booked. Thanks!" },
];
const DURATION = 32.56;
const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

export function NegotiationPlayer() {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => { if (audio.current) setT(audio.current.currentTime); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  let idx = 0;
  LINES.forEach((l, i) => { if (t >= l.start - 0.05) idx = i; });
  const line = LINES[idx];
  const talking = playing && t <= line.end;
  const started = playing || t > 0;

  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) { if (a.ended) a.currentTime = 0; void a.play(); } else a.pause();
  };

  return (
    <div className={s.player} data-playing={playing || undefined}>
      <button type="button" className={s.play} onClick={toggle} aria-label={playing ? "Pause the call" : "Play the call"}>
        {playing ? (
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor" /><rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor" /></svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor" /></svg>
        )}
      </button>

      <div className={s.body}>
        <div className={s.meta}>
          <span className={s.who} data-who={line.who}>{line.who}</span>
          <span className={s.bars} data-on={talking || undefined} data-who={line.who} aria-hidden="true">
            {Array.from({ length: 5 }, (_, i) => <i key={i} style={{ "--i": i } as CSSProperties} />)}
          </span>
          <span className={s.tag}>AI voice</span>
          <span className={s.time}>{fmt(t)} / {fmt(DURATION)}</span>
        </div>
        {/* every line is stacked in one cell, so the card is always as tall as the longest line: no layout shift */}
        <div className={s.captions} data-idle={!started || undefined}>
          {LINES.map((l, i) => (
            <p key={l.start} className={s.caption} data-on={i === idx || undefined} aria-hidden={i !== idx}>{l.text}</p>
          ))}
        </div>
        <div className={s.track} aria-hidden="true">
          {LINES.map((l) => <i key={l.start} data-who={l.who} style={{ left: `${(l.start / DURATION) * 100}%`, width: `${((l.end - l.start) / DURATION) * 100}%` }} />)}
          <b style={{ transform: `scaleX(${t / DURATION})` }} />
        </div>
      </div>

      <audio
        ref={audio}
        src="/landing/negotiation.mp3"
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setT(DURATION); }}
        onTimeUpdate={(e) => { if (!playing) setT(e.currentTarget.currentTime); }}
      />
    </div>
  );
}

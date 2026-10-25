"use client";
import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import Link from "next/link";
import NextImage from "next/image";
import { Bot } from "../Bot";

const POINTS = ["Scans hundreds of live listings", "Blocks scams before you pay", "Calls and negotiates with landlords", "Books the viewing for you"];

type Phase = "idle" | "sending" | "sent" | "guest";

export default function LoginForm({ url, anonKey, linkError }: { url: string; anonKey: string; linkError: boolean }) {
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState(linkError ? "That link expired. Send a new one." : "");

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setPhase("sending");
    const sb = createBrowserClient(url, anonKey);
    const { error: err } = await sb.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: `${location.origin}/auth/callback?next=/app` } });
    if (err) { setPhase("idle"); setError(/rate limit/i.test(err.message) ? "Too many emails right now. Continue as guest." : err.message); return; }
    setPhase("sent");
  };

  const guest = async () => {
    setError(""); setPhase("guest");
    const r = await fetch("/auth/guest", { method: "POST" }).catch(() => null);
    if (r?.ok) { location.assign("/app"); return; }
    setPhase("idle"); setError("Guest sign-in is unavailable. Try the magic link.");
  };

  return (
    <main className="login">
      <aside className="login-side">
        <NextImage src="/app-sf.jpg" alt="" fill priority sizes="(max-width: 900px) 100vw, 55vw" className="login-photo" />
        <div className="login-side-in">
          <Link href="/" className="login-logo" aria-label="Sublet Sniper home"><span><Bot size={30} /></span>Sublet Sniper</Link>
          <div className="login-pitch">
            <h2>Your San Francisco sublet, handled.</h2>
            <p>Tell your agent what you want. It does the rest.</p>
            <ul>
              {POINTS.map((x) => <li key={x}><i aria-hidden="true"><svg viewBox="0 0 24 24" width="13" height="13"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg></i>{x}</li>)}
            </ul>
          </div>
          <small>Built at the Personal Agents Hackathon, San Francisco 2026</small>
        </div>
      </aside>
      <section className="login-main">
        <div className="login-card">
          <h1>Sign in</h1>
          <p className="login-sub">No password. Start in seconds.</p>
          {phase === "sent" ? (
            <p className="login-sent">Check your inbox. The link signs you in on this device.</p>
          ) : (
            <form onSubmit={send}>
              <label htmlFor="email">Email</label>
              <input id="email" type="email" required autoComplete="email" placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              <button className="primary lg" type="submit" disabled={phase !== "idle" || !email.includes("@")}>{phase === "sending" ? "Sending…" : "Send magic link"}</button>
            </form>
          )}
          <div className="login-or"><span>or</span></div>
          <button className="ghost lg" onClick={() => void guest()} disabled={phase === "guest" || phase === "sending"}>{phase === "guest" ? "Starting…" : "Continue as guest"}</button>
          {error && <p className="login-error" role="alert">{error}</p>}
        </div>
      </section>
    </main>
  );
}

"use client";
import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import Link from "next/link";
import { Bot } from "../Bot";

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
      <div className="login-card">
        <Link href="/" className="login-brand" aria-label="Sublet Sniper home"><Bot size={44} /></Link>
        <h1>Sign in to Sublet Sniper</h1>
        {phase === "sent" ? (
          <p className="login-sent">Check your inbox. The link signs you in on this device.</p>
        ) : (
          <form onSubmit={send}>
            <label htmlFor="email" className="sr">Email</label>
            <input id="email" type="email" required autoComplete="email" placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button className="primary lg" type="submit" disabled={phase !== "idle" || !email.includes("@")}>{phase === "sending" ? "Sending…" : "Send magic link"}</button>
          </form>
        )}
        <div className="login-or"><span>or</span></div>
        <button className="ghost lg" onClick={() => void guest()} disabled={phase === "guest" || phase === "sending"}>{phase === "guest" ? "Starting…" : "Continue as guest"}</button>
        {error && <p className="login-error" role="alert">{error}</p>}
      </div>
    </main>
  );
}

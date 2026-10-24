import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { supabaseAnonKey, supabaseConfigured, supabaseUrl } from "@/lib/supabase/env";
import LoginForm from "./LoginForm";
import "./login.css";

export const metadata: Metadata = { title: "Sign in · Sublet Sniper" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!supabaseConfigured()) redirect("/app");
  const { error } = await searchParams;
  return <LoginForm url={supabaseUrl()} anonKey={supabaseAnonKey()} linkError={error === "link"} />;
}

import { redirect } from "next/navigation";
import Dashboard from "../Dashboard";
import { currentUser, supabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = supabaseConfigured() ? await currentUser() : null;
  if (supabaseConfigured() && !user) redirect("/login");
  return <div className="app"><Dashboard elevenLabsAgentId={process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID ?? null} user={user} /></div>;
}

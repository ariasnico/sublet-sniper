import Dashboard from "../Dashboard";
export default function Page() { return <div className="app"><Dashboard elevenLabsAgentId={process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID ?? null} /></div>; }

import { llmProvider } from "./config";

export interface ToolDef { name: string; description: string; parameters: Record<string, unknown> }
export type ToolExec = (name: string, input: Record<string, unknown>) => Promise<unknown>;
export interface Turn { role: "user" | "assistant"; text: string }

const MAX_STEPS = 8;

function jsonObject(x: unknown): Record<string, unknown> {
  return x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
}

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`LLM ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return jsonObject(json);
}

// ---------- Anthropic Messages API ----------
type ABlock = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } | { type: "tool_result"; tool_use_id: string; content: string };
async function anthropicLoop(system: string, history: Turn[], tools: ToolDef[], exec: ToolExec): Promise<string> {
  const messages: { role: "user" | "assistant"; content: string | ABlock[] }[] = history.map((t) => ({ role: t.role, content: t.text }));
  for (let step = 0; step < MAX_STEPS; step++) {
    const r = await post("https://api.anthropic.com/v1/messages",
      { "x-api-key": process.env.ANTHROPIC_API_KEY ?? "", "anthropic-version": "2023-06-01" },
      { model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5", max_tokens: 1500, system, messages,
        tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) });
    const content = (Array.isArray(r.content) ? r.content : []) as ABlock[];
    messages.push({ role: "assistant", content });
    const uses = content.filter((b): b is Extract<ABlock, { type: "tool_use" }> => b.type === "tool_use");
    if (!uses.length) return content.filter((b): b is Extract<ABlock, { type: "text" }> => b.type === "text").map((b) => b.text).join("\n");
    const results = await Promise.all(uses.map(async (u) => ({ type: "tool_result" as const, tool_use_id: u.id, content: JSON.stringify(await exec(u.name, u.input).catch((e: Error) => ({ error: e.message }))) })));
    messages.push({ role: "user", content: results });
  }
  return "(stopped after max tool steps)";
}

// ---------- OpenAI-compatible (xAI Grok / OpenAI) ----------
interface OAMsg { role: string; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[]; tool_call_id?: string }
async function openaiLoop(system: string, history: Turn[], tools: ToolDef[], exec: ToolExec): Promise<string> {
  const xai = llmProvider() === "xai";
  const base = xai ? "https://api.x.ai/v1" : "https://api.openai.com/v1";
  const key = (xai ? process.env.XAI_API_KEY : process.env.OPENAI_API_KEY) ?? "";
  const model = xai ? process.env.XAI_MODEL || "grok-4" : process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const messages: OAMsg[] = [{ role: "system", content: system }, ...history.map((t) => ({ role: t.role, content: t.text }))];
  for (let step = 0; step < MAX_STEPS; step++) {
    const r = await post(`${base}/chat/completions`, { authorization: `Bearer ${key}` },
      { model, messages, tools: tools.length ? tools.map((t) => ({ type: "function", function: t })) : undefined });
    const choice = jsonObject((Array.isArray(r.choices) ? r.choices : [])[0]);
    const msg = jsonObject(choice.message) as unknown as OAMsg;
    messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });
    if (!msg.tool_calls?.length) return msg.content ?? "";
    for (const c of msg.tool_calls) {
      let input: Record<string, unknown> = {};
      try { input = jsonObject(JSON.parse(c.function.arguments || "{}")); } catch { /* keep empty */ }
      const out = await exec(c.function.name, input).catch((e: Error) => ({ error: e.message }));
      messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(out) });
    }
  }
  return "(stopped after max tool steps)";
}

/** Runs a tool-calling loop on the configured provider. Returns null in mock mode so callers use deterministic logic. */
export async function runToolLoop(system: string, history: Turn[], tools: ToolDef[], exec: ToolExec): Promise<string | null> {
  const p = llmProvider();
  if (p === "mock") return null;
  return p === "anthropic" ? anthropicLoop(system, history, tools, exec) : openaiLoop(system, history, tools, exec);
}

/** Single completion, no tools. Returns null in mock mode. */
export async function complete(system: string, user: string): Promise<string | null> {
  return runToolLoop(system, [{ role: "user", text: user }], [], async () => ({}));
}

/** Ask the model for strict JSON; returns null on mock or parse failure. */
export async function completeJson(system: string, user: string): Promise<unknown> {
  const out = await complete(`${system}\nRespond with ONLY valid JSON, no prose, no code fences.`, user).catch(() => null);
  if (!out) return null;
  try { return JSON.parse(out.replace(/^```(json)?|```$/g, "").trim()); } catch { return null; }
}

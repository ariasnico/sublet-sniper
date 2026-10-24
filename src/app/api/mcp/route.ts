import { mcpHandler, withBearer } from "@/lib/mcp";

// Remote MCP server (Streamable HTTP, stateless). Agents connect to https://<host>/api/mcp.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const handler = withBearer(mcpHandler);
export { handler as GET, handler as POST, handler as DELETE };

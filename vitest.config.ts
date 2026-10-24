import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({ resolve: { alias: { "@": path.resolve(__dirname, "src") } }, test: { environment: "node", env: { CRAIGSLIST_LIVE: "0", LLM_PROVIDER: "mock", MAIL_MODE: "mock", CALENDAR_MODE: "mock" } } });

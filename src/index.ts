import { initDb } from "./db/schema.ts";
import { createQueries } from "./db/queries.ts";
import { createThreatManager } from "./agent/threats.ts";
import { createEventBus } from "./events.ts";
import { startDashboard } from "./dashboard/server.ts";
import { AI_NAME, AI_TAGLINE } from "./agent/glados.ts";

const title = `MISSION CONTROL — ${AI_NAME} Oversight v0.1`;
const tagline = `"${AI_TAGLINE}"`;
const width = Math.max(title.length, tagline.length);
console.log(`
╔${"═".repeat(width + 4)}╗
║  ${title.padEnd(width)}  ║
║  ${tagline.padEnd(width)}  ║
╚${"═".repeat(width + 4)}╝
`);

// 1. Database
const db = initDb();
const queries = createQueries(db);
console.log("[init] Database ready");

// 2. Event bus
const bus = createEventBus();

// 3. Threat manager
const threats = createThreatManager(queries);

// 4. Dashboard — serves UI + context API
// Kill data is fetched on-demand when players identify, no background polling needed.
const port = parseInt(process.env.PORT ?? "3000");
startDashboard({ bus, queries, threats }, port);

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[shutdown] Powering down... she'll remember this.");
  db.close();
  process.exit(0);
});

console.log("[init] All systems operational. She's watching.\n");

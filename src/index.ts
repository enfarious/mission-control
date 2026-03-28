import { initDb } from "./db/schema.ts";
import { createQueries } from "./db/queries.ts";
import { createChainListener } from "./chain/listener.ts";
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

// 4. Chain listener — kill events feed the threat registry
const listener = createChainListener((kill) => {
  console.log(`[kill] Kill detected: killer=${kill.killerId}, victim=${kill.victimId}`);

  const result = threats.processKill(kill);
  bus.emit("kill", { wallet: result.wallet, threat: result.threat });
  bus.emit("threat", {
    wallet: result.wallet,
    threat: result.threat,
    isNew: result.isNew,
  });

  console.log(
    `[threat] ${result.isNew ? "NEW" : "UPDATED"}: ${result.wallet} (${result.threat.threat_level}, ${result.threat.hit_count} hits)`
  );
});

listener.start().catch((err) => {
  console.error("[chain] Failed to start listener:", err);
});

// 5. Dashboard — serves UI + context API
const port = parseInt(process.env.PORT ?? "3000");
startDashboard({ bus, queries, threats }, port);

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[shutdown] GladOS powering down... she'll remember this.");
  listener.stop();
  db.close();
  process.exit(0);
});

console.log("[init] All systems operational. She's watching.\n");

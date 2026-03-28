import { initDb } from "./db/schema.ts";
import { createQueries } from "./db/queries.ts";
import { createChainListener } from "./chain/listener.ts";
import { createSigner } from "./chain/signer.ts";
import { createGladOS } from "./agent/glados.ts";
import { createThreatManager } from "./agent/threats.ts";
import { createEventBus } from "./events.ts";
import { startDashboard } from "./dashboard/server.ts";

console.log(`
╔═══════════════════════════════════════════╗
║  MISSION CONTROL — GladOS Oversight v0.1  ║
║  "I'm doing science and I'm still alive"  ║
╚═══════════════════════════════════════════╝
`);

// 1. Database
const db = initDb();
const queries = createQueries(db);
console.log("[init] Database ready");

// 2. Event bus
const bus = createEventBus();

// 3. Agent
const glados = createGladOS(queries);
const threats = createThreatManager(queries);
console.log("[init] GladOS online");

// 4. Chain listener
const listener = createChainListener(async (kill, log) => {
  console.log(`[kill] Kill detected: killer=${kill.killerCharacterId}, victim=${kill.victimCharacterId}`);

  const result = threats.processKill(kill);
  bus.emit("kill", { wallet: result.wallet, threat: result.threat });
  bus.emit("threat", { wallet: result.wallet, threat: result.threat, isNew: result.isNew });

  // GladOS narrates
  try {
    const narration = await glados.narrateKill(
      result.wallet,
      "0x" + kill.victimCharacterId.toString(16),
      Number(kill.killTimestamp)
    );
    bus.emit("chat", { speaker: "glados", message: narration });
    console.log(`[glados] ${narration}`);
  } catch (err) {
    console.error("[glados] Narration failed:", err);
  }
});

listener.start();

// 5. Signer (optional)
const signer = createSigner();

// 6. Dashboard
const port = parseInt(process.env.PORT ?? "3000");
startDashboard({ bus, queries, glados, threats }, port);

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[shutdown] GladOS powering down... she'll remember this.");
  listener.stop();
  db.close();
  process.exit(0);
});

console.log("[init] All systems operational. She's watching.\n");

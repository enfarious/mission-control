/**
 * test-gate-scraper.ts
 * Run with: bun run src/chain/test-gate-scraper.ts
 */

import { scrapeGateNetwork, printGateGraphSummary } from "./gate-scraper.js";
import { writeFileSync } from "fs";

console.log("Starting gate network scrape...\n");

try {
  const graph = await scrapeGateNetwork();
  printGateGraphSummary(graph);

  // Dump full link list to JSON for inspection
  const output = {
    scrapedAt: graph.scrapedAt,
    stats: {
      totalGates: graph.gates.size,
      activeLinks: graph.links.length,
      linkedEvents: graph.linkedCount,
      unlinkedEvents: graph.unlinkedCount,
    },
    links: graph.links.map((l) => ({
      from: l.from,
      to: l.to,
      fromTenant: l.fromKey.tenant_id,
      toTenant: l.toKey.tenant_id,
      fromItem: l.fromKey.item_id,
      toItem: l.toKey.item_id,
    })),
    allGates: Array.from(graph.gates.values()).map((g) => ({
      gateId: g.gateId,
      tenantId: g.key.tenant_id,
      itemId: g.key.item_id,
      linkedTo: g.linkedTo,
    })),
  };

  const outPath = "./gate-network.json";
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`💾 Full graph written to ${outPath}\n`);

} catch (err) {
  console.error("Scrape failed:", err);
  process.exit(1);
}

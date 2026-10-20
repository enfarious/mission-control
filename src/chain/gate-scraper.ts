/**
 * gate-scraper.ts
 * Scrapes all GateLinkedEvent and GateUnlinkedEvent from the Sui chain
 * to build a live graph of the Eve Frontier gate network topology.
 */

import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { WORLD_PACKAGE, SUI_NETWORK } from "./contracts.js";

// --- Event type strings ---
export const GATE_LINKED_EVENT = `${WORLD_PACKAGE}::gate::GateLinkedEvent`;
export const GATE_UNLINKED_EVENT = `${WORLD_PACKAGE}::gate::GateUnlinkedEvent`;

// --- Types ---

export interface TenantItemId {
  tenant_id: string;
  item_id: string;
}

export interface GateLinkedEventData {
  source_gate_id: string;
  source_gate_key: TenantItemId;
  destination_gate_id: string;
  destination_gate_key: TenantItemId;
}

export interface GateNode {
  gateId: string;
  key: TenantItemId;
  linkedTo: string | null;
  linkedToKey: TenantItemId | null;
}

export interface GateGraph {
  gates: Map<string, GateNode>;
  links: Array<{ from: string; to: string; fromKey: TenantItemId; toKey: TenantItemId }>;
  linkedCount: number;
  unlinkedCount: number;
  totalEvents: number;
  scrapedAt: string;
}

// --- Scraper ---

async function fetchAllEvents(
  client: SuiJsonRpcClient,
  eventType: string,
  label: string
): Promise<any[]> {
  const allEvents: any[] = [];
  let cursor: any = null;
  let page = 0;

  process.stdout.write(`  Fetching ${label}...`);

  while (true) {
    const response = await client.queryEvents({
      query: { MoveEventType: eventType },
      cursor,
      limit: 50,
      order: "ascending",
    });

    allEvents.push(...response.data);
    page++;

    process.stdout.write(`\r  ${label}: ${allEvents.length} events (page ${page})   `);

    if (!response.hasNextPage) break;
    cursor = response.nextCursor;

    // Polite delay — don't hammer the RPC
    await new Promise((r) => setTimeout(r, 120));
  }

  console.log(); // newline after progress
  return allEvents;
}

export async function scrapeGateNetwork(): Promise<GateGraph> {
  const client = new SuiJsonRpcClient({
    url: getJsonRpcFullnodeUrl(SUI_NETWORK),
  });

  console.log(`\n🔭 Scraping gate network from ${SUI_NETWORK}...`);
  console.log(`   World package: ${WORLD_PACKAGE}\n`);

  const [linkedEvents, unlinkedEvents] = await Promise.all([
    fetchAllEvents(client, GATE_LINKED_EVENT, "GateLinkedEvent  "),
    fetchAllEvents(client, GATE_UNLINKED_EVENT, "GateUnlinkedEvent"),
  ]);

  console.log(`\n  Raw events: ${linkedEvents.length} links, ${unlinkedEvents.length} unlinks\n`);

  // Merge and sort by checkpoint + sequence for correct replay order
  const allEvents = [
    ...linkedEvents.map((e) => ({ ...e, kind: "link" as const })),
    ...unlinkedEvents.map((e) => ({ ...e, kind: "unlink" as const })),
  ].sort((a, b) => {
    const cpDiff = Number(BigInt(a.checkpoint ?? "0") - BigInt(b.checkpoint ?? "0"));
    if (cpDiff !== 0) return cpDiff;
    return Number(BigInt(a.id?.eventSeq ?? "0") - BigInt(b.id?.eventSeq ?? "0"));
  });

  const gates = new Map<string, GateNode>();

  function upsertGate(id: string, key: TenantItemId) {
    if (!id) return;
    if (!gates.has(id)) {
      gates.set(id, { gateId: id, key, linkedTo: null, linkedToKey: null });
    }
  }

  for (const event of allEvents) {
    const parsed = event.parsedJson as GateLinkedEventData;
    if (!parsed) continue;

    const srcId = parsed.source_gate_id;
    const dstId = parsed.destination_gate_id;
    const srcKey = parsed.source_gate_key;
    const dstKey = parsed.destination_gate_key;

    if (!srcId || !dstId) continue;

    upsertGate(srcId, srcKey);
    upsertGate(dstId, dstKey);

    if (event.kind === "link") {
      gates.get(srcId)!.linkedTo = dstId;
      gates.get(srcId)!.linkedToKey = dstKey;
      gates.get(dstId)!.linkedTo = srcId;
      gates.get(dstId)!.linkedToKey = srcKey;
    } else {
      gates.get(srcId)!.linkedTo = null;
      gates.get(srcId)!.linkedToKey = null;
      gates.get(dstId)!.linkedTo = null;
      gates.get(dstId)!.linkedToKey = null;
    }
  }

  // Build deduplicated link list (each pair once)
  const seen = new Set<string>();
  const links: GateGraph["links"] = [];

  for (const gate of gates.values()) {
    if (!gate.linkedTo) continue;
    const pairKey = [gate.gateId, gate.linkedTo].sort().join(":");
    if (!seen.has(pairKey)) {
      seen.add(pairKey);
      links.push({
        from: gate.gateId,
        to: gate.linkedTo,
        fromKey: gate.key,
        toKey: gate.linkedToKey!,
      });
    }
  }

  return {
    gates,
    links,
    linkedCount: linkedEvents.length,
    unlinkedCount: unlinkedEvents.length,
    totalEvents: allEvents.length,
    scrapedAt: new Date().toISOString(),
  };
}

export function printGateGraphSummary(graph: GateGraph) {
  const totalGates = graph.gates.size;
  const activeLinks = graph.links.length;
  const linkedGates = graph.links.length * 2;
  const unlinkedGates = totalGates - linkedGates;

  // System-to-system analysis
  const crossSystemLinks = graph.links.filter(
    (l) => l.fromKey?.tenant_id && l.toKey?.tenant_id &&
            l.fromKey.tenant_id !== l.toKey.tenant_id
  );
  const sameSystemLinks = graph.links.filter(
    (l) => l.fromKey?.tenant_id && l.toKey?.tenant_id &&
            l.fromKey.tenant_id === l.toKey.tenant_id
  );
  const unknownLinks = graph.links.filter(
    (l) => !l.fromKey?.tenant_id || !l.toKey?.tenant_id
  );

  // Group gates by system — guard against missing tenant_id
  const systemMap = new Map<string, string[]>();
  for (const gate of graph.gates.values()) {
    const sys = gate.key?.tenant_id ?? "(unknown)";
    if (!systemMap.has(sys)) systemMap.set(sys, []);
    systemMap.get(sys)!.push(gate.gateId);
  }

  console.log("═══════════════════════════════════════════════════════");
  console.log("  GATE NETWORK — TOPOLOGY REPORT");
  console.log(`  Scraped at: ${graph.scrapedAt}`);
  console.log("═══════════════════════════════════════════════════════\n");

  console.log("📊 Event totals:");
  console.log(`   GateLinkedEvent:   ${graph.linkedCount}`);
  console.log(`   GateUnlinkedEvent: ${graph.unlinkedCount}`);
  console.log(`   Net total events:  ${graph.totalEvents}\n`);

  console.log("🗺️  Network state:");
  console.log(`   Total gate objects seen: ${totalGates}`);
  console.log(`   Currently active links:  ${activeLinks}`);
  console.log(`   Gates with active link:  ${linkedGates}`);
  console.log(`   Gates without a link:    ${unlinkedGates}\n`);

  console.log("🌐 Systems (unique tenant IDs):");
  console.log(`   Count: ${systemMap.size}`);
  const sortedSystems = [...systemMap.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [sysId, gateIds] of sortedSystems) {
    const shortSys = sysId.length > 20 ? sysId.slice(0, 20) + "..." : sysId;
    console.log(`   ${shortSys.padEnd(26)}  ${gateIds.length} gate(s)`);
  }

  console.log(`\n🔗 Link topology:`);
  console.log(`   Same-system links:    ${sameSystemLinks.length}`);
  console.log(`   Cross-system links:   ${crossSystemLinks.length}`);
  console.log(`   Unknown/null-key:     ${unknownLinks.length}`);

  if (crossSystemLinks.length > 0) {
    console.log("\n   Cross-system connections:");
    for (const link of crossSystemLinks) {
      const fromSys = (link.fromKey.tenant_id ?? "?").slice(0, 14) + "...";
      const toSys = (link.toKey.tenant_id ?? "?").slice(0, 14) + "...";
      console.log(`   [${fromSys}] ↔ [${toSys}]`);
      console.log(`     ${link.from.slice(0, 16)}... ↔ ${link.to.slice(0, 16)}...`);
    }
  } else {
    console.log("\n   ℹ️  No cross-system links found.");
    console.log("      tenant_id may represent owner address rather than solar system.");
    console.log("      Check sample data below to understand the ID scheme.");
  }

  console.log("\n🔍 Sample links (first 5):");
  for (const link of graph.links.slice(0, 5)) {
    console.log(`\n   ${link.from.slice(0, 20)}... `);
    console.log(`   ↔ ${link.to.slice(0, 20)}...`);
    console.log(`   from tenant_id: ${link.fromKey?.tenant_id ?? "(null)"}`);
    console.log(`   to   tenant_id: ${link.toKey?.tenant_id ?? "(null)"}`);
    console.log(`   from item_id:   ${link.fromKey?.item_id ?? "(null)"}`);
    console.log(`   to   item_id:   ${link.toKey?.item_id ?? "(null)"}`);
  }

  console.log("\n═══════════════════════════════════════════════════════\n");
}

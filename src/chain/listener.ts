import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import {
  KILLMAIL_EVENT_TYPE,
  SUI_NETWORK,
  WORLD_PACKAGE,
  type KillMailData,
  type KillMailEvent,
} from "./contracts.ts";

export type KillHandler = (kill: KillMailData) => void;

export function createChainListener(onKill: KillHandler) {
  const rpcUrl = process.env.SUI_RPC_URL ?? getJsonRpcFullnodeUrl(SUI_NETWORK);

  const client = new SuiJsonRpcClient({ url: rpcUrl });

  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let lastSeenEventId: { txDigest: string; eventSeq: string } | undefined;
  const seenDigests = new Set<string>();
  let consecutiveErrors = 0;

  async function start() {
    console.log(`[chain] Sui ${SUI_NETWORK} — polling ${WORLD_PACKAGE.slice(0, 10)}... for kills`);

    // Initial query to set cursor (don't process old events)
    try {
      const initial = await client.queryEvents({
        query: { MoveEventType: KILLMAIL_EVENT_TYPE },
        order: "descending",
        limit: 1,
      });

      if (initial.data.length > 0) {
        lastSeenEventId = {
          txDigest: initial.data[0]!.id.txDigest,
          eventSeq: initial.data[0]!.id.eventSeq,
        };
        console.log(`[chain] Cursor set to latest event: ${lastSeenEventId.txDigest.slice(0, 10)}...`);
      }
    } catch (err) {
      console.warn("[chain] Could not fetch initial events:", (err as Error).message);
    }

    // Start polling
    pollInterval = setInterval(poll, 15_000);
    console.log("[chain] Polling active (15s interval)");
  }

  async function poll() {
    try {
      const result = await client.queryEvents({
        query: { MoveEventType: KILLMAIL_EVENT_TYPE },
        order: "ascending",
        limit: 25,
        cursor: lastSeenEventId,
      });

      for (const event of result.data) {
        const digest = event.id.txDigest + ":" + event.id.eventSeq;
        if (seenDigests.has(digest)) continue;
        seenDigests.add(digest);

        // Keep set bounded
        if (seenDigests.size > 1000) {
          const first = seenDigests.values().next().value;
          if (first) seenDigests.delete(first);
        }

        lastSeenEventId = {
          txDigest: event.id.txDigest,
          eventSeq: event.id.eventSeq,
        };

        try {
          const kill = parseKillEvent(event.parsedJson as KillMailEvent);
          onKill(kill);
        } catch (err) {
          console.error("[chain] Failed to parse kill event:", err);
        }
      }
      consecutiveErrors = 0;
    } catch (err: any) {
      consecutiveErrors++;
      const status = err?.status || err?.statusCode || '';
      const msg = status ? `HTTP ${status}` : (err?.message || 'unknown error');
      console.warn(`[chain] Poll failed (${msg}) — attempt ${consecutiveErrors}`);

      // Back off: skip next N polls proportional to error count (max ~2 min gap)
      if (consecutiveErrors >= 3) {
        const backoffMs = Math.min(consecutiveErrors * 15_000, 120_000);
        console.warn(`[chain] Backing off ${Math.round(backoffMs / 1000)}s`);
        stop();
        setTimeout(() => {
          pollInterval = setInterval(poll, 15_000);
        }, backoffMs);
      }
    }
  }

  function stop() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  return { start, stop, client };
}

function parseKillEvent(raw: KillMailEvent): KillMailData {
  return {
    killerId: raw.killer_id?.item_id ?? "unknown",
    victimId: raw.victim_id?.item_id ?? "unknown",
    lossType: raw.loss_type ?? "SHIP",
    killTimestamp: parseInt(raw.kill_timestamp) || Math.floor(Date.now() / 1000),
    solarSystemId: raw.solar_system_id?.item_id ?? "unknown",
    raw,
  };
}

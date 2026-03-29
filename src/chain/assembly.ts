/**
 * Sui queries for assembly status, character lookup, and kill stats.
 */
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import {
  SUI_NETWORK,
  SUI_GRAPHQL_ENDPOINT,
  WORLD_PACKAGE,
  KILLMAIL_EVENT_TYPE,
  type AssemblyStatus,
  type CharacterData,
} from "./contracts.ts";

const WORLD_API = "https://world-api-stillness.live.tech.evefrontier.com";

// --- Tribe Name Cache ---
let tribeCache: Map<number, string> | null = null;
let tribeCachePromise: Promise<Map<number, string>> | null = null;

async function getTribeMap(): Promise<Map<number, string>> {
  if (tribeCache) return tribeCache;
  if (tribeCachePromise) return tribeCachePromise;

  tribeCachePromise = (async () => {
    const map = new Map<number, string>();
    try {
      let offset = 0;
      const limit = 500;
      while (true) {
        const res = await fetch(`${WORLD_API}/v2/tribes?limit=${limit}&offset=${offset}`);
        if (!res.ok) break;
        const json = await res.json() as any;
        const items: any[] = json.data ?? [];
        for (const t of items) map.set(t.id, t.name);
        const total = json.metadata?.total ?? 0;
        offset += items.length;
        if (items.length === 0 || offset >= total) break;
      }
      console.log(`[assembly] Cached ${map.size} tribe names`);
    } catch (err) {
      console.error("[assembly] Tribe fetch failed:", err);
    }
    tribeCache = map;
    // Refresh after 1 hour
    setTimeout(() => { tribeCache = null; tribeCachePromise = null; }, 60 * 60 * 1000);
    return map;
  })();

  return tribeCachePromise;
}

export async function resolveTribeName(tribeId: number): Promise<string> {
  const map = await getTribeMap();
  return map.get(tribeId) ?? `Tribe ${tribeId}`;
}

let client: SuiJsonRpcClient | null = null;

function getClient(): SuiJsonRpcClient {
  if (!client) {
    client = new SuiJsonRpcClient({
      url: process.env.SUI_RPC_URL ?? getJsonRpcFullnodeUrl(SUI_NETWORK),
    });
  }
  return client;
}

async function gql(query: string, label?: string): Promise<any> {
  const res = await fetch(SUI_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const raw = await res.json() as any;
  if (raw?.errors) {
    console.error(`[gql${label ? ` ${label}` : ""}] errors:`, JSON.stringify(raw.errors));
  }
  return raw?.data;
}

// --- Assembly Status ---

export async function fetchAssemblyStatus(assemblyId: string): Promise<AssemblyStatus | null> {
  try {
    const c = getClient();
    const obj = await c.getObject({
      id: assemblyId,
      options: { showContent: true, showType: true },
    });

    if (!obj.data) return null;

    const content = obj.data.content;
    const fields = content?.dataType === "moveObject" ? (content as any).fields : {};

    // Extract status from the object's fields
    const status = fields?.status;
    const isOnline = status?.fields?.current_state === 2 || status?.fields?.is_online === true;
    const metadata = fields?.metadata?.fields ?? {};

    return {
      id: assemblyId,
      type: obj.data.type ?? "unknown",
      isOnline,
      name: metadata?.name ?? "Unknown Assembly",
      description: metadata?.description ?? "",
      metadata: fields,
    };
  } catch (err) {
    console.error("[assembly] Failed to fetch status:", err);
    return null;
  }
}

// --- Character Lookup ---
// Strategy:
//  1. Query PlayerProfile (owned by the wallet) to get character_id address
//  2. Fetch Character object by that address for name + tribe_id
// PlayerProfile is wallet-owned so this is an O(1) lookup, not a scan.

export async function fetchCharacterByWallet(wallet: string): Promise<CharacterData | null> {
  try {
    const profileType = `${WORLD_PACKAGE}::character::PlayerProfile`;

    // Step 1: Find PlayerProfile owned by this wallet
    const profileData = await gql(`{
      address(address: "${wallet}") {
        objects(filter: { type: "${profileType}" }, first: 1) {
          nodes {
            contents {
              json
            }
          }
        }
      }
    }`, "PlayerProfile");

    const profileNode = profileData?.address?.objects?.nodes?.[0];
    if (!profileNode) {
      console.log(`[assembly] No PlayerProfile found for ${shortenWallet(wallet)}`);
      return { characterId: "", name: "", tribeId: 0, wallet };
    }

    const profileJson = profileNode.contents?.json as any;
    // character_id can be either a plain address string or an object { address }
    const charAddr: string =
      profileJson?.character_id?.address ??
      profileJson?.character_id ??
      "";

    if (!charAddr) {
      console.log(`[assembly] PlayerProfile has no character_id for ${shortenWallet(wallet)}`);
      return { characterId: "", name: "", tribeId: 0, wallet };
    }

    // Step 2: Fetch Character object by its address
    // object() returns generic Object type, so we need asMoveObject to get contents
    const charData = await gql(`{
      object(address: "${charAddr}") {
        asMoveObject {
          contents {
            json
          }
        }
      }
    }`, "Character");

    const charJson = charData?.object?.asMoveObject?.contents?.json as any;
    const name = charJson?.metadata?.name ?? charJson?.name ?? "";
    const tribeId = charJson?.tribe_id ?? 0;
    const characterItemId = charJson?.key?.item_id ?? charAddr;

    console.log(`[assembly] Resolved ${shortenWallet(wallet)} → "${name}" (tribe: ${tribeId})`);

    return { characterId: characterItemId, name, tribeId, wallet };
  } catch (err) {
    console.error("[assembly] Character lookup failed:", err);
    return { characterId: "", name: "", tribeId: 0, wallet };
  }
}

// --- Kill Stats ---

export async function fetchKillStats(characterItemId: string): Promise<{
  kills: number;
  deaths: number;
}> {
  try {
    const c = getClient();

    // Count kills by this character
    const killEvents = await c.queryEvents({
      query: { MoveEventType: KILLMAIL_EVENT_TYPE },
      limit: 50,
    });

    let kills = 0;
    let deaths = 0;

    for (const event of killEvents.data) {
      const parsed = event.parsedJson as any;
      if (parsed?.killer_id?.item_id === characterItemId) kills++;
      if (parsed?.victim_id?.item_id === characterItemId) deaths++;
    }

    return { kills, deaths };
  } catch (err) {
    console.error("[assembly] Kill stats query failed:", err);
    return { kills: 0, deaths: 0 };
  }
}

function shortenWallet(w: string): string {
  if (w.length <= 12) return w;
  return w.slice(0, 6) + "..." + w.slice(-4);
}

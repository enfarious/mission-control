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

let client: SuiJsonRpcClient | null = null;

function getClient(): SuiJsonRpcClient {
  if (!client) {
    client = new SuiJsonRpcClient({
      url: process.env.SUI_RPC_URL ?? getJsonRpcFullnodeUrl(SUI_NETWORK),
    });
  }
  return client;
}

async function gql(query: string): Promise<any> {
  const res = await fetch(SUI_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const data = await res.json();
  return (data as any)?.data;
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

export async function fetchCharacterByWallet(wallet: string): Promise<CharacterData | null> {
  try {
    // Query for PlayerProfile objects owned by this wallet
    const data = await gql(`{
      address(address: "${wallet}") {
        objects(filter: { type: "${WORLD_PACKAGE}::character::Character" }, first: 1) {
          nodes {
            address
            asMoveObject {
              contents {
                json
              }
            }
          }
        }
      }
    }`);

    const node = data?.address?.objects?.nodes?.[0];
    if (!node) {
      // Try looking for any character-like object
      return await fetchCharacterFallback(wallet);
    }

    const json = node.asMoveObject?.contents?.json;
    return {
      characterId: node.address,
      name: json?.metadata?.name ?? json?.name ?? shortenWallet(wallet),
      tribeId: json?.tribe_id ?? 0,
      wallet,
    };
  } catch (err) {
    console.error("[assembly] Character lookup failed:", err);
    return {
      characterId: "",
      name: shortenWallet(wallet),
      tribeId: 0,
      wallet,
    };
  }
}

async function fetchCharacterFallback(wallet: string): Promise<CharacterData | null> {
  // Fallback: just return a stub with the wallet
  return {
    characterId: "",
    name: shortenWallet(wallet),
    tribeId: 0,
    wallet,
  };
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

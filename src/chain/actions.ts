/**
 * Server-side PTB builders for SSU access control and turret config.
 * Ported from frontier-ops-clean/dapps/src/core/ssu-access-actions.ts
 * Adapted for server-side signing with owner's private key.
 */
import { Transaction } from "@mysten/sui/transactions";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import {
  SSU_EXT_PKG,
  SSU_EXT_CONFIG,
  TURRET_EXT_PKG,
  TURRET_EXT_CONFIG,
  OWNER_WALLET,
  OWNER_PRIVATE_KEY,
  SUI_NETWORK,
  SUI_GRAPHQL_ENDPOINT,
  type AccessRulesData,
} from "./contracts.ts";

let client: SuiJsonRpcClient | null = null;
let keypair: Ed25519Keypair | null = null;
let cachedSsuAdminCap: string | null = null;
let cachedTurretAdminCap: string | null = null;

function getClient(): SuiJsonRpcClient {
  if (!client) {
    client = new SuiJsonRpcClient({
      url: process.env.SUI_RPC_URL ?? getJsonRpcFullnodeUrl(SUI_NETWORK),
    });
  }
  return client;
}

function getKeypair(): Ed25519Keypair {
  if (!keypair) {
    if (!OWNER_PRIVATE_KEY) throw new Error("OWNER_PRIVATE_KEY not set");
    keypair = Ed25519Keypair.fromSecretKey(OWNER_PRIVATE_KEY);
  }
  return keypair;
}

// --- AdminCap lookup via GraphQL ---

async function findAdminCap(pkgId: string, configModule: string): Promise<string> {
  const query = `{
    address(address: "${OWNER_WALLET}") {
      objects(filter: { type: "${pkgId}::${configModule}::AdminCap" }, first: 1) {
        nodes { address }
      }
    }
  }`;

  const res = await fetch(SUI_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });

  const data = (await res.json()) as any;
  const addr = data?.data?.address?.objects?.nodes?.[0]?.address;
  if (!addr) throw new Error(`AdminCap not found for ${pkgId}::${configModule}`);
  return addr;
}

async function getSsuAdminCap(): Promise<string> {
  if (cachedSsuAdminCap) return cachedSsuAdminCap;
  cachedSsuAdminCap = await findAdminCap(SSU_EXT_PKG, "config");
  console.log(`[actions] SSU AdminCap: ${cachedSsuAdminCap}`);
  return cachedSsuAdminCap;
}

async function getTurretAdminCap(): Promise<string> {
  if (!TURRET_EXT_PKG) throw new Error("TURRET_EXT_PKG not configured");
  if (cachedTurretAdminCap) return cachedTurretAdminCap;
  cachedTurretAdminCap = await findAdminCap(TURRET_EXT_PKG, "config");
  console.log(`[actions] Turret AdminCap: ${cachedTurretAdminCap}`);
  return cachedTurretAdminCap;
}

// --- Execute helper ---

async function signAndExecute(tx: Transaction): Promise<string> {
  const kp = getKeypair();
  const c = getClient();

  tx.setSender(OWNER_WALLET);

  const result = await c.signAndExecuteTransaction({
    transaction: tx,
    signer: kp,
  });

  console.log(`[actions] TX executed: ${result.digest}`);
  return result.digest;
}

// --- SSU Access Control ---

export async function grantStorageAccess(
  ssuId: string,
  characterItemId: string
): Promise<{ digest: string }> {
  if (!SSU_EXT_PKG) throw new Error("SSU_EXT_PKG not configured");
  const adminCap = await getSsuAdminCap();

  const tx = new Transaction();

  // Grant both deposit and withdraw
  tx.moveCall({
    target: `${SSU_EXT_PKG}::access::add_deposit_access`,
    arguments: [
      tx.object(SSU_EXT_CONFIG),
      tx.object(adminCap),
      tx.pure.id(ssuId),
      tx.pure.u64(BigInt(characterItemId)),
    ],
  });

  tx.moveCall({
    target: `${SSU_EXT_PKG}::access::add_withdraw_access`,
    arguments: [
      tx.object(SSU_EXT_CONFIG),
      tx.object(adminCap),
      tx.pure.id(ssuId),
      tx.pure.u64(BigInt(characterItemId)),
    ],
  });

  const digest = await signAndExecute(tx);
  return { digest };
}

export async function revokeStorageAccess(
  ssuId: string,
  characterItemId: string
): Promise<{ digest: string }> {
  if (!SSU_EXT_PKG) throw new Error("SSU_EXT_PKG not configured");

  // To revoke, we need to read current rules, remove the character, and set new rules
  const currentRules = await fetchAccessRules(ssuId);
  if (!currentRules) throw new Error("No access rules found for this SSU");

  const newRules: AccessRulesData = {
    ...currentRules,
    depositAllowlist: currentRules.depositAllowlist.filter((id) => id !== characterItemId),
    withdrawAllowlist: currentRules.withdrawAllowlist.filter((id) => id !== characterItemId),
  };

  return setAccessRules(ssuId, newRules);
}

export async function setAccessRules(
  ssuId: string,
  rules: AccessRulesData
): Promise<{ digest: string }> {
  if (!SSU_EXT_PKG) throw new Error("SSU_EXT_PKG not configured");
  const adminCap = await getSsuAdminCap();

  const tx = new Transaction();

  tx.moveCall({
    target: `${SSU_EXT_PKG}::access::set_access_rules`,
    arguments: [
      tx.object(SSU_EXT_CONFIG),
      tx.object(adminCap),
      tx.pure.id(ssuId),
      tx.pure.vector("u64", rules.depositAllowlist.map((id) => BigInt(id))),
      tx.pure.vector("u64", rules.withdrawAllowlist.map((id) => BigInt(id))),
      tx.pure.vector("u32", rules.depositTribes),
      tx.pure.vector("u32", rules.withdrawTribes),
      tx.pure.bool(rules.openDeposit),
      tx.pure.bool(rules.openWithdraw),
    ],
  });

  const digest = await signAndExecute(tx);
  return { digest };
}

export async function setOpenAccess(
  ssuId: string,
  openDeposit: boolean,
  openWithdraw: boolean
): Promise<{ digest: string }> {
  const currentRules = await fetchAccessRules(ssuId);
  const rules: AccessRulesData = currentRules ?? {
    depositAllowlist: [],
    withdrawAllowlist: [],
    depositTribes: [],
    withdrawTribes: [],
    openDeposit: true,
    openWithdraw: false,
  };

  rules.openDeposit = openDeposit;
  rules.openWithdraw = openWithdraw;

  return setAccessRules(ssuId, rules);
}

// --- Turret Config ---

export async function setTurretFriendlyTribes(
  tribes: number[]
): Promise<{ digest: string }> {
  if (!TURRET_EXT_PKG) throw new Error("TURRET_EXT_PKG not configured");
  const adminCap = await getTurretAdminCap();

  const tx = new Transaction();

  tx.moveCall({
    target: `${TURRET_EXT_PKG}::targeting::set_targeting_config`,
    arguments: [
      tx.object(TURRET_EXT_CONFIG),
      tx.object(adminCap),
      tx.pure.vector("u32", tribes),
      tx.pure.bool(false), // weakest_first
      tx.pure.bool(true),  // use_specialization
      tx.pure.bool(false), // shoot_friendly_aggressors
    ],
  });

  const digest = await signAndExecute(tx);
  return { digest };
}

export async function setTurretHostile(): Promise<{ digest: string }> {
  if (!TURRET_EXT_PKG) throw new Error("TURRET_EXT_PKG not configured");
  const adminCap = await getTurretAdminCap();

  const tx = new Transaction();

  // Empty friendly tribes + shoot everyone including friendlies
  tx.moveCall({
    target: `${TURRET_EXT_PKG}::targeting::set_targeting_config`,
    arguments: [
      tx.object(TURRET_EXT_CONFIG),
      tx.object(adminCap),
      tx.pure.vector("u32", []),
      tx.pure.bool(true),  // weakest_first — pick off the easy ones
      tx.pure.bool(true),  // use_specialization
      tx.pure.bool(true),  // shoot_friendly_aggressors — shoot EVERYONE
    ],
  });

  const digest = await signAndExecute(tx);
  return { digest };
}

// --- Read State ---

export async function fetchAccessRules(ssuId: string): Promise<AccessRulesData | null> {
  const query = `{
    object(address: "${SSU_EXT_CONFIG}") {
      dynamicField(name: {
        type: "${SSU_EXT_PKG}::access::AccessRulesKey",
        bcs: "${ssuId}"
      }) {
        value {
          ... on MoveValue { json }
        }
      }
    }
  }`;

  try {
    const res = await fetch(SUI_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });

    const data = (await res.json()) as any;
    const json = data?.data?.object?.dynamicField?.value?.json;
    if (!json) return null;

    return {
      depositAllowlist: (json.deposit_allowlist || []).map(String),
      withdrawAllowlist: (json.withdraw_allowlist || []).map(String),
      depositTribes: json.deposit_tribes || [],
      withdrawTribes: json.withdraw_tribes || [],
      openDeposit: json.open_deposit ?? true,
      openWithdraw: json.open_withdraw ?? false,
    };
  } catch {
    return null;
  }
}

// --- Action dispatcher (called from API endpoint) ---

export interface AIAction {
  type: string;
  target?: string;
  tribes?: number[];
  reason?: string;
}

export async function executeAction(
  action: AIAction,
  assemblyId: string
): Promise<{ type: string; digest?: string; error?: string }> {
  try {
    switch (action.type) {
      case "grant_access": {
        if (!action.target) throw new Error("No target for grant_access");
        const result = await grantStorageAccess(assemblyId, action.target);
        return { type: action.type, digest: result.digest };
      }
      case "revoke_access": {
        if (!action.target) throw new Error("No target for revoke_access");
        const result = await revokeStorageAccess(assemblyId, action.target);
        return { type: action.type, digest: result.digest };
      }
      case "open_access": {
        const result = await setOpenAccess(assemblyId, true, true);
        return { type: action.type, digest: result.digest };
      }
      case "lock_access": {
        const result = await setOpenAccess(assemblyId, false, false);
        return { type: action.type, digest: result.digest };
      }
      case "set_turret_friendly": {
        const result = await setTurretFriendlyTribes(action.tribes ?? []);
        return { type: action.type, digest: result.digest };
      }
      case "set_turret_hostile": {
        const result = await setTurretHostile();
        return { type: action.type, digest: result.digest };
      }
      default:
        return { type: action.type, error: `Unknown action type: ${action.type}` };
    }
  } catch (err) {
    console.error(`[actions] Failed to execute ${action.type}:`, err);
    return { type: action.type, error: (err as Error).message };
  }
}

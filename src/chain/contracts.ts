// Eve Frontier — Sui Testnet
// World contracts package from Published.toml (testnet environment)
export const WORLD_PACKAGE =
  process.env.WORLD_PACKAGE ??
  "0x28b497559d65ab320d9da4613bf2498d5946b2c0ae3597ccfda3072ce127448c";

export const SUI_NETWORK = (process.env.SUI_NETWORK ?? "testnet") as "testnet" | "mainnet" | "devnet";

export const SUI_GRAPHQL_ENDPOINT =
  process.env.SUI_GRAPHQL_ENDPOINT ?? "https://graphql.testnet.sui.io/graphql";

// Owner config
export const OWNER_WALLET = process.env.OWNER_WALLET ?? "";
export const OWNER_PRIVATE_KEY = process.env.OWNER_PRIVATE_KEY ?? "";

// SSU Extension
export const SSU_EXT_PKG =
  process.env.SSU_EXT_PKG ??
  "0x6ff020848c52633e061fd84e6f45c4a1f9d2df97ba94af625649454324c237a8";
export const SSU_EXT_CONFIG =
  process.env.SSU_EXT_CONFIG ??
  "0xd325d0be956235ba700eeccead13de161ef9569470a21bbc9b47ee1ae7f4f933";

// Turret Extension
export const TURRET_EXT_PKG = process.env.TURRET_EXT_PKG ?? "";
export const TURRET_EXT_CONFIG = process.env.TURRET_EXT_CONFIG ?? "";

// Event type strings
export const KILLMAIL_EVENT_TYPE = `${WORLD_PACKAGE}::killmail::KillmailCreatedEvent`;

// --- Types ---

export interface TenantItemId {
  tenant_id: string;
  item_id: string;
}

export interface KillMailEvent {
  key: TenantItemId;
  killer_id: TenantItemId;
  victim_id: TenantItemId;
  reported_by_character_id: TenantItemId;
  loss_type: string;
  kill_timestamp: string;
  solar_system_id: TenantItemId;
}

export interface KillMailData {
  killerId: string;
  victimId: string;
  lossType: string;
  killTimestamp: number;
  solarSystemId: string;
  raw: KillMailEvent;
}

export interface AccessRulesData {
  depositAllowlist: string[];
  withdrawAllowlist: string[];
  depositTribes: number[];
  withdrawTribes: number[];
  openDeposit: boolean;
  openWithdraw: boolean;
}

export interface AssemblyStatus {
  id: string;
  type: string;
  isOnline: boolean;
  name: string;
  description: string;
  metadata: Record<string, any>;
}

export interface CharacterData {
  characterId: string;
  name: string;
  tribeId: number;
  wallet: string;
}

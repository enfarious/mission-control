// Eve Frontier — Sui Testnet
// World contracts package from Published.toml (testnet environment)
export const WORLD_PACKAGE =
  process.env.WORLD_PACKAGE ??
  "0x33226d2eedda428eb7e1a56faf525bd5300f9394a5d61ffbbbcb3993d45a7145";

export const SUI_NETWORK = (process.env.SUI_NETWORK ?? "testnet") as "testnet" | "mainnet" | "devnet";

// Event type strings for subscription filters
export const KILLMAIL_EVENT_TYPE = `${WORLD_PACKAGE}::killmail::KillmailCreatedEvent`;

// Parsed kill mail event data (matches KillmailCreatedEvent Move struct)
export interface KillMailEvent {
  key: TenantItemId;
  killer_id: TenantItemId;
  victim_id: TenantItemId;
  reported_by_character_id: TenantItemId;
  loss_type: string; // "SHIP" | "STRUCTURE"
  kill_timestamp: string; // u64 as string
  solar_system_id: TenantItemId;
}

// TenantItemId is a Move struct — Sui SDK will parse it as an object
export interface TenantItemId {
  tenant_id: string;
  item_id: string;
}

// Normalized kill data for our system
export interface KillMailData {
  killerId: string;
  victimId: string;
  lossType: string;
  killTimestamp: number;
  solarSystemId: string;
  raw: KillMailEvent;
}

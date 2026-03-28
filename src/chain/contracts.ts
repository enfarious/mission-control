import { type Abi, type Address, type Hex } from "viem";

// Eve Frontier — OP Sepolia
export const CHAIN_ID = 11155420;
export const RPC_URL =
  process.env.RPC_URL ??
  "https://op-sepolia-ext-sync-node-rpc.live.tech.evefrontier.com";

export const WORLD_ADDRESS: Address =
  (process.env.WORLD_ADDRESS as Address) ??
  "0x1dacc0b64b7da0cc6e2b2fe1bd37363c";

// MUD Store events — the universal event layer for all state changes
export const STORE_ABI = [
  {
    type: "event",
    name: "Store_SetRecord",
    inputs: [
      {
        name: "tableId",
        type: "bytes32",
        indexed: true,
        internalType: "ResourceId",
      },
      {
        name: "keyTuple",
        type: "bytes32[]",
        indexed: false,
        internalType: "bytes32[]",
      },
      {
        name: "staticData",
        type: "bytes",
        indexed: false,
        internalType: "bytes",
      },
      {
        name: "encodedLengths",
        type: "bytes32",
        indexed: false,
        internalType: "EncodedLengths",
      },
      {
        name: "dynamicData",
        type: "bytes",
        indexed: false,
        internalType: "bytes",
      },
    ],
  },
  {
    type: "event",
    name: "Store_DeleteRecord",
    inputs: [
      {
        name: "tableId",
        type: "bytes32",
        indexed: true,
        internalType: "ResourceId",
      },
      {
        name: "keyTuple",
        type: "bytes32[]",
        indexed: false,
        internalType: "bytes32[]",
      },
    ],
  },
] as const satisfies Abi;

// KillMail table ResourceId
// namespace: "evefrontier", table: "KillMail"
// hex: tb + evefrontier (14 bytes) + KillMail (16 bytes)
export const KILLMAIL_TABLE_ID: Hex =
  "0x746265766566726f6e746965720000004b696c6c4d61696c0000000000000000";

// DeployableState table ResourceId
export const DEPLOYABLE_STATE_TABLE_ID: Hex =
  "0x746265766566726f6e746965720000004465706c6f7961626c65537461746500";

// KillMailLossType enum
export enum KillMailLossType {
  SHIP = 0,
  POD = 1,
}

// DeployableState enum
export enum DeployableState {
  NULL = 0,
  UNANCHORED = 1,
  ANCHORED = 2,
  ONLINE = 3,
  DESTROYED = 4,
}

export interface KillMailData {
  killMailId: bigint;
  killerCharacterId: bigint;
  victimCharacterId: bigint;
  lossType: KillMailLossType;
  solarSystemId: bigint;
  killTimestamp: bigint;
}

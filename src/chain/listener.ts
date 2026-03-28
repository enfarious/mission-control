import {
  createPublicClient,
  http,
  webSocket,
  type Log,
  decodeAbiParameters,
  type Hex,
} from "viem";
import { optimismSepolia } from "viem/chains";
import {
  STORE_ABI,
  KILLMAIL_TABLE_ID,
  WORLD_ADDRESS,
  RPC_URL,
  type KillMailData,
  KillMailLossType,
} from "./contracts.ts";

export type KillHandler = (kill: KillMailData, log: Log) => void;

export function createChainListener(onKill: KillHandler) {
  const transport = RPC_URL.startsWith("wss") ? webSocket(RPC_URL) : http(RPC_URL);

  const client = createPublicClient({
    chain: optimismSepolia,
    transport,
  });

  let unwatch: (() => void) | null = null;

  function start() {
    console.log(`[chain] Watching ${WORLD_ADDRESS} for KillMail events...`);

    unwatch = client.watchContractEvent({
      address: WORLD_ADDRESS,
      abi: STORE_ABI,
      eventName: "Store_SetRecord",
      args: { tableId: KILLMAIL_TABLE_ID },
      onLogs: (logs) => {
        for (const log of logs) {
          try {
            const kill = decodeKillMail(log);
            if (kill) onKill(kill, log);
          } catch (err) {
            console.error("[chain] Failed to decode kill mail:", err);
          }
        }
      },
      onError: (err) => {
        console.error("[chain] Watch error:", err);
      },
    });
  }

  function stop() {
    unwatch?.();
    unwatch = null;
  }

  return { start, stop, client };
}

function decodeKillMail(log: Log): KillMailData | null {
  const args = (log as any).args;
  if (!args) return null;

  const { keyTuple, staticData } = args;
  if (!keyTuple?.length || !staticData) return null;

  // keyTuple[0] = killMailId (uint256 as bytes32)
  const killMailId = BigInt(keyTuple[0] as Hex);

  // staticData layout: 5 x uint256 (160 bytes) + 1 x uint8
  // killerCharacterId (32) | victimCharacterId (32) | lossType (1) | solarSystemId (32) | killTimestamp (32)
  // MUD packs static data tightly, so we decode it
  try {
    const decoded = decodeAbiParameters(
      [
        { name: "killerCharacterId", type: "uint256" },
        { name: "victimCharacterId", type: "uint256" },
        { name: "lossType", type: "uint8" },
        { name: "solarSystemId", type: "uint256" },
        { name: "killTimestamp", type: "uint256" },
      ],
      staticData as Hex
    );

    return {
      killMailId,
      killerCharacterId: decoded[0],
      victimCharacterId: decoded[1],
      lossType: decoded[2] as KillMailLossType,
      solarSystemId: decoded[3],
      killTimestamp: decoded[4],
    };
  } catch {
    // MUD uses tight packing, not standard ABI encoding.
    // Fall back to manual slice if ABI decode fails.
    const data = staticData as Hex;
    const hex = data.slice(2); // remove 0x

    if (hex.length < 266) return null; // need at least 133 bytes

    return {
      killMailId,
      killerCharacterId: BigInt("0x" + hex.slice(0, 64)),
      victimCharacterId: BigInt("0x" + hex.slice(64, 128)),
      lossType: parseInt(hex.slice(128, 130), 16) as KillMailLossType,
      solarSystemId: BigInt("0x" + hex.slice(130, 194)),
      killTimestamp: BigInt("0x" + hex.slice(194, 258)),
    };
  }
}

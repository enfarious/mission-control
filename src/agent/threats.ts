import type { Queries, Threat } from "../db/queries.ts";
import type { KillMailData } from "../chain/contracts.ts";

export function createThreatManager(queries: Queries) {
  function processKill(kill: KillMailData): {
    wallet: string;
    threat: Threat;
    isNew: boolean;
  } {
    const wallet = "0x" + kill.killerCharacterId.toString(16).padStart(40, "0");
    const timestamp = Number(kill.killTimestamp);
    const victimHex = "0x" + kill.victimCharacterId.toString(16).padStart(40, "0");

    const existing = queries.getThreat(wallet);
    const isNew = !existing;

    queries.insertThreat(
      wallet,
      timestamp,
      `Destroyed entity ${victimHex.slice(0, 10)}... at ${new Date(timestamp * 1000).toISOString()}`
    );

    queries.insertEvent("kill", kill, undefined, undefined);

    const threat = queries.getThreat(wallet)!;
    return { wallet, threat, isNew };
  }

  function getThreatLevel(wallet: string): Threat | null {
    return queries.getThreat(wallet);
  }

  function getAllThreats(): Threat[] {
    return queries.getAllThreats();
  }

  function assignNickname(wallet: string, nickname: string) {
    queries.updateNickname(wallet, nickname);
  }

  return { processKill, getThreatLevel, getAllThreats, assignNickname };
}

export type ThreatManager = ReturnType<typeof createThreatManager>;

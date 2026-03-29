import type { Queries, Threat } from "../db/queries.ts";
import type { KillMailData } from "../chain/contracts.ts";

export function createThreatManager(queries: Queries) {
  function processKill(kill: KillMailData): {
    wallet: string;
    threat: Threat;
    isNew: boolean;
  } {
    const wallet = kill.killerId;
    const timestamp = kill.killTimestamp;

    const existing = queries.getThreat(wallet);
    const isNew = !existing;

    queries.insertThreat(
      wallet,
      timestamp,
      `Destroyed ${kill.victimId.slice(0, 10)}... (${kill.lossType}) at ${new Date(timestamp * 1000).toISOString()}`
    );

    queries.insertEvent("kill", kill);

    const threat = queries.getThreat(wallet)!;
    return { wallet, threat, isNew };
  }

  function getThreatLevel(wallet: string): Threat | null {
    return queries.getThreat(wallet);
  }

  function getAllThreats(): Threat[] {
    return queries.getAllThreats();
  }

  function registerVisitorThreat(wallet: string, kills: number) {
    queries.insertThreat(
      wallet,
      Math.floor(Date.now() / 1000),
      `Identified on visit — ${kills} recorded kills`
    );
  }

  function assignNickname(wallet: string, nickname: string) {
    queries.updateNickname(wallet, nickname);
  }

  return { processKill, getThreatLevel, getAllThreats, assignNickname, registerVisitorThreat };
}

export type ThreatManager = ReturnType<typeof createThreatManager>;

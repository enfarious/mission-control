import type { Database } from "bun:sqlite";

export interface Threat {
  id: number;
  wallet: string;
  nickname: string | null;
  hit_count: number;
  threat_level: string;
  first_seen: number;
  last_seen: number;
  reason: string | null;
  bounty_status: string;
}

export interface ChatEntry {
  id: number;
  timestamp: number;
  speaker: string;
  wallet: string | null;
  message: string;
}

export interface EventEntry {
  id: number;
  event_type: string;
  tx_hash: string | null;
  block_number: number | null;
  timestamp: number;
  data: string;
}

export function createQueries(db: Database) {
  const insertThreat = db.prepare<void, [string, number, string]>(
    `INSERT INTO threats (wallet, first_seen, last_seen, reason)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(wallet) DO UPDATE SET
       hit_count = hit_count + 1,
       last_seen = excluded.last_seen,
       reason = excluded.reason,
       threat_level = CASE
         WHEN hit_count + 1 >= 5 THEN 'critical'
         WHEN hit_count + 1 >= 3 THEN 'dangerous'
         WHEN hit_count + 1 >= 2 THEN 'hostile'
         ELSE 'noted'
       END`
  );

  const getThreat = db.prepare<Threat, [string]>(
    `SELECT * FROM threats WHERE wallet = ?`
  );

  const getAllThreats = db.prepare<Threat, []>(
    `SELECT * FROM threats ORDER BY hit_count DESC`
  );

  const updateNickname = db.prepare<void, [string, string]>(
    `UPDATE threats SET nickname = ? WHERE wallet = ?`
  );

  const insertChat = db.prepare<void, [number, string, string | null, string]>(
    `INSERT INTO chat_log (timestamp, speaker, wallet, message)
     VALUES (?, ?, ?, ?)`
  );

  const getRecentChat = db.prepare<ChatEntry, [number]>(
    `SELECT * FROM chat_log ORDER BY timestamp DESC LIMIT ?`
  );

  const insertEvent = db.prepare<void, [string, string | null, number | null, number, string]>(
    `INSERT INTO events (event_type, tx_hash, block_number, timestamp, data)
     VALUES (?, ?, ?, ?, ?)`
  );

  const getRecentEvents = db.prepare<EventEntry, [number]>(
    `SELECT * FROM events ORDER BY timestamp DESC LIMIT ?`
  );

  return {
    insertThreat: (wallet: string, timestamp: number, reason: string) =>
      insertThreat.run(wallet, timestamp, timestamp, reason),

    getThreat: (wallet: string): Threat | null =>
      getThreat.get(wallet),

    getAllThreats: (): Threat[] =>
      getAllThreats.all(),

    updateNickname: (wallet: string, nickname: string) =>
      updateNickname.run(nickname, wallet),

    insertChat: (speaker: string, message: string, wallet?: string) =>
      insertChat.run(Date.now(), speaker, wallet ?? null, message),

    getRecentChat: (limit = 20): ChatEntry[] =>
      getRecentChat.all(limit).reverse(),

    insertEvent: (
      eventType: string,
      data: object,
      txHash?: string,
      blockNumber?: number
    ) =>
      insertEvent.run(
        eventType,
        txHash ?? null,
        blockNumber ?? null,
        Date.now(),
        JSON.stringify(data)
      ),

    getRecentEvents: (limit = 50): EventEntry[] =>
      getRecentEvents.all(limit),

    // --- Visitors ---
    upsertVisitor: (wallet: string, data: {
      characterId?: string;
      name?: string;
      tribeId?: number;
      kills?: number;
      deaths?: number;
    }) => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO visitors (wallet, character_id, name, tribe_id, kills, deaths, first_visit, last_visit, reputation)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 50)
        ON CONFLICT(wallet) DO UPDATE SET
          character_id = COALESCE(excluded.character_id, character_id),
          name = COALESCE(excluded.name, name),
          tribe_id = COALESCE(excluded.tribe_id, tribe_id),
          kills = COALESCE(excluded.kills, kills),
          deaths = COALESCE(excluded.deaths, deaths),
          visit_count = visit_count + 1,
          last_visit = excluded.last_visit
      `).run(
        wallet,
        data.characterId ?? null,
        data.name ?? null,
        data.tribeId ?? null,
        data.kills ?? 0,
        data.deaths ?? 0,
        now,
        now
      );
    },

    getVisitor: (wallet: string) =>
      db.prepare(`SELECT * FROM visitors WHERE wallet = ?`).get(wallet) as any | null,

    updateVisitorReputation: (wallet: string, reputation: number, notes?: string) => {
      db.prepare(`UPDATE visitors SET reputation = ?, ai_notes = ? WHERE wallet = ?`)
        .run(Math.max(0, Math.min(100, reputation)), notes ?? null, wallet);
    },

    // --- Tribes ---
    upsertTribe: (tribeId: number, memberKills: number, memberDeaths: number, tribeName?: string) => {
      db.prepare(`
        INSERT INTO tribes (tribe_id, name, member_visits, total_kills, total_deaths, reputation)
        VALUES (?, ?, 1, ?, ?, 50)
        ON CONFLICT(tribe_id) DO UPDATE SET
          name = COALESCE(excluded.name, name),
          member_visits = member_visits + 1,
          total_kills = total_kills + excluded.total_kills,
          total_deaths = total_deaths + excluded.total_deaths
      `).run(tribeId, tribeName ?? null, memberKills, memberDeaths);
    },

    getTribe: (tribeId: number) =>
      db.prepare(`SELECT * FROM tribes WHERE tribe_id = ?`).get(tribeId) as any | null,

    getAllTribes: () =>
      db.prepare(`SELECT * FROM tribes ORDER BY reputation DESC`).all() as any[],

    updateTribeReputation: (tribeId: number, reputation: number, notes?: string) => {
      db.prepare(`UPDATE tribes SET reputation = ?, ai_notes = ? WHERE tribe_id = ?`)
        .run(Math.max(0, Math.min(100, reputation)), notes ?? null, tribeId);
    },
  };
}

export type Queries = ReturnType<typeof createQueries>;

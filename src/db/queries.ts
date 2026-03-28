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
  };
}

export type Queries = ReturnType<typeof createQueries>;

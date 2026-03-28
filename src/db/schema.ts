import { Database } from "bun:sqlite";

const DB_PATH = "glados.db";

export function initDb(): Database {
  const db = new Database(DB_PATH, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS threats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL,
      nickname TEXT,
      hit_count INTEGER NOT NULL DEFAULT 1,
      threat_level TEXT NOT NULL DEFAULT 'noted',
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      reason TEXT,
      bounty_status TEXT NOT NULL DEFAULT 'pending'
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_threats_wallet ON threats(wallet);

    CREATE TABLE IF NOT EXISTS chat_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      speaker TEXT NOT NULL,
      wallet TEXT,
      message TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      tx_hash TEXT,
      block_number INTEGER,
      timestamp INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `);

  return db;
}

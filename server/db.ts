import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'nextonstage.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS songs (
    id        TEXT PRIMARY KEY,
    title     TEXT NOT NULL,
    artist    TEXT NOT NULL,
    source    TEXT NOT NULL,           -- JSON SongSource
    origin    TEXT NOT NULL,           -- 'media' | 'youtube'
    added_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS parties (
    code          TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    mode          TEXT NOT NULL,       -- 'curated' | 'open'
    signups_open  INTEGER NOT NULL DEFAULT 1,
    host_token    TEXT NOT NULL,
    stage_token   TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'idle',
    seq           INTEGER NOT NULL DEFAULT 0,
    command       TEXT,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS party_songs (
    party_code  TEXT NOT NULL REFERENCES parties(code) ON DELETE CASCADE,
    song_id     TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    PRIMARY KEY (party_code, song_id)
  );

  CREATE TABLE IF NOT EXISTS queue (
    id          TEXT PRIMARY KEY,
    party_code  TEXT NOT NULL REFERENCES parties(code) ON DELETE CASCADE,
    song_id     TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    singer      TEXT NOT NULL,
    guest_id    TEXT,
    position    REAL NOT NULL,
    state       TEXT NOT NULL,         -- 'queued' | 'current' | 'done' | 'removed'
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS queue_party ON queue(party_code, state, position);
`);

/* Migrations for columns added after the first release. */
function addColumn(table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}
addColumn('songs', 'raw_title', 'TEXT'); // the original video title / filename that artist+title were inferred from
addColumn('songs', 'genre', 'TEXT');
// pending | pending_genre | matched | unmatched | manual
addColumn('songs', 'meta_status', "TEXT NOT NULL DEFAULT 'pending'");

addColumn('parties', 'owner_id', 'TEXT');
addColumn('parties', 'theme', "TEXT NOT NULL DEFAULT 'classic'");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id             TEXT PRIMARY KEY,
    email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name           TEXT NOT NULL,
    password_hash  TEXT NOT NULL,
    created_at     INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id_hash     TEXT PRIMARY KEY,           -- sha256 of the cookie token
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS playlists (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    song_ids    TEXT NOT NULL,              -- JSON array of song ids
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS guests (
    id          TEXT PRIMARY KEY,           -- the guest's device id
    name        TEXT NOT NULL DEFAULT '',
    blurb       TEXT NOT NULL DEFAULT '',
    avatar      TEXT,                       -- file name in DATA_DIR/avatars
    updated_at  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash  TEXT PRIMARY KEY,           -- sha256 of the emailed token
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS parties_owner ON parties(owner_id);
  CREATE INDEX IF NOT EXISTS queue_guest ON queue(guest_id);
`);

/** Run fn inside a transaction. */
export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

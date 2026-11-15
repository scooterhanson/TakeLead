/** Things a signed-in host owns: parties and saved playlists. */
import crypto from 'node:crypto';
import { db } from './db.ts';
import { HttpError } from './errors.ts';
import { getSong } from './catalog.ts';
import type { AccountParty, PartyTheme, SavedPlaylist } from '../src/shared/types.ts';

export function listParties(userId: string): AccountParty[] {
  const rows = db
    .prepare(
      `SELECT p.code, p.name, p.theme, p.created_at,
              (SELECT COUNT(*) FROM queue q WHERE q.party_code = p.code AND q.state = 'done') AS sung,
              (SELECT COUNT(*) FROM queue q WHERE q.party_code = p.code AND q.state IN ('queued','current')) AS queued
         FROM parties p WHERE p.owner_id = ? ORDER BY p.created_at DESC`,
    )
    .all(userId) as { code: string; name: string; theme: PartyTheme; created_at: number; sung: number; queued: number }[];
  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    theme: r.theme,
    createdAt: r.created_at,
    songsSung: r.sung,
    queued: r.queued,
  }));
}

interface PlaylistRow {
  id: string;
  user_id: string;
  name: string;
  song_ids: string;
  updated_at: number;
}

const toPlaylist = (r: PlaylistRow): SavedPlaylist => ({
  id: r.id,
  name: r.name,
  // Songs deleted from the catalog drop out quietly.
  songIds: (JSON.parse(r.song_ids) as string[]).filter((id) => getSong(id)),
  updatedAt: r.updated_at,
});

export function listPlaylists(userId: string): SavedPlaylist[] {
  const rows = db
    .prepare('SELECT * FROM playlists WHERE user_id = ? ORDER BY name COLLATE NOCASE')
    .all(userId) as unknown as PlaylistRow[];
  return rows.map(toPlaylist);
}

export function getPlaylist(userId: string, id: string): SavedPlaylist {
  const r = db.prepare('SELECT * FROM playlists WHERE id = ? AND user_id = ?').get(id, userId) as unknown as
    | PlaylistRow
    | undefined;
  if (!r) throw new HttpError(404, 'Playlist not found.');
  return toPlaylist(r);
}

const cleanSongIds = (ids: unknown) =>
  [...new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string' && !!getSong(x)) : [])].slice(
    0,
    5000,
  );

const cleanPlaylistName = (n: unknown) => {
  const name = String(n ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!name) throw new HttpError(400, 'Name the playlist.');
  return name;
};

export function createPlaylist(userId: string, input: { name?: unknown; songIds?: unknown }): SavedPlaylist {
  const id = crypto.randomBytes(9).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO playlists (id, user_id, name, song_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    userId,
    cleanPlaylistName(input.name),
    JSON.stringify(cleanSongIds(input.songIds)),
    now,
    now,
  );
  return getPlaylist(userId, id);
}

export function updatePlaylist(userId: string, id: string, input: { name?: unknown; songIds?: unknown }): SavedPlaylist {
  const current = getPlaylist(userId, id);
  db.prepare('UPDATE playlists SET name = ?, song_ids = ?, updated_at = ? WHERE id = ?').run(
    input.name !== undefined ? cleanPlaylistName(input.name) : current.name,
    JSON.stringify(input.songIds !== undefined ? cleanSongIds(input.songIds) : current.songIds),
    Date.now(),
    id,
  );
  return getPlaylist(userId, id);
}

export function deletePlaylist(userId: string, id: string) {
  getPlaylist(userId, id);
  db.prepare('DELETE FROM playlists WHERE id = ?').run(id);
}

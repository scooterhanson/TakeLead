import crypto from 'node:crypto';
import { db, tx } from './db.ts';
import { HttpError } from './errors.ts';
import { getSong, listSongs, rowToSong } from './catalog.ts';
import type {
  ControlAction,
  CreatePartyResponse,
  PartyMode,
  PartyState,
  PartyTheme,
  PlaybackStatus,
  QueueEntry,
  Song,
} from '../src/shared/types.ts';

interface PartyRow {
  code: string;
  name: string;
  mode: PartyMode;
  signups_open: number;
  host_token: string;
  stage_token: string;
  status: PlaybackStatus;
  seq: number;
  command: 'restart' | null;
  created_at: number;
  owner_id: string | null;
  theme: PartyTheme;
}

interface EntryRow {
  id: string;
  singer: string;
  guest_id: string | null;
  state: string;
  created_at: number;
  song_id: string;
  title: string;
  artist: string;
  source: string;
  origin: string;
  avatar: string | null;
  blurb: string | null;
}

/* Broadcast hook: index.ts wires this up to Socket.IO. */
let notify: (code: string) => void = () => {};
export function onPartyChange(fn: (code: string) => void) {
  notify = fn;
}
export const notifyParty = (code: string) => notify(code);

export const THEME_IDS: PartyTheme[] = ['classic', 'light', 'dark', 'sixties', 'seventies', 'eighties', 'win95', 'winxp'];

/** Names compare case- and whitespace-insensitively: "jess " == "Jess". */
export const nameKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();
export const cleanName = (name: unknown) => String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid confusion with 1/0
const randomToken = () => crypto.randomBytes(18).toString('base64url');
const randomId = () => crypto.randomBytes(9).toString('base64url');

function newCode(): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    if (!db.prepare('SELECT 1 FROM parties WHERE code = ?').get(code)) return code;
  }
  throw new HttpError(500, 'Could not create a party code. Try again.');
}

const normalize = (code: string) => String(code ?? '').trim().toUpperCase();

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function partyRow(code: string): PartyRow {
  const row = db.prepare('SELECT * FROM parties WHERE code = ?').get(normalize(code)) as unknown as PartyRow | undefined;
  if (!row) throw new HttpError(404, 'Party not found.');
  return row;
}

export function assertHost(code: string, token: string) {
  if (!safeEqual(partyRow(code).host_token, token ?? '')) throw new HttpError(403, 'Only the host can do that.');
}

export function isHost(code: string, token: string) {
  try {
    assertHost(code, token);
    return true;
  } catch {
    return false;
  }
}

export function isStage(code: string, token: string) {
  try {
    const p = partyRow(code);
    return safeEqual(p.stage_token, token ?? '') || safeEqual(p.host_token, token ?? '');
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------- reads */

function activeEntries(code: string): EntryRow[] {
  return db
    .prepare(
      `SELECT q.id, q.singer, q.guest_id, q.state, q.created_at,
              s.id AS song_id, s.title, s.artist, s.source, s.origin, s.genre,
              g.avatar, NULLIF(g.blurb, '') AS blurb
         FROM queue q JOIN songs s ON s.id = q.song_id
         LEFT JOIN guests g ON g.id = q.guest_id
        WHERE q.party_code = ? AND q.state IN ('queued', 'current')
        ORDER BY q.position`,
    )
    .all(code) as unknown as EntryRow[];
}

const toEntry = (r: EntryRow & { genre?: string | null }): QueueEntry => ({
  id: r.id,
  singer: r.singer,
  avatarUrl: r.avatar ? `/avatars/${r.avatar}` : null,
  blurb: r.blurb,
  createdAt: r.created_at,
  song: rowToSong({ id: r.song_id, title: r.title, artist: r.artist, source: r.source, origin: r.origin, genre: r.genre }),
});

export function getState(code: string): PartyState {
  const p = partyRow(code);
  const rows = activeEntries(p.code);
  const currentRow = rows.find((r) => r.state === 'current');
  const playlist = db.prepare('SELECT song_id FROM party_songs WHERE party_code = ?').all(p.code) as {
    song_id: string;
  }[];
  const sung = db.prepare("SELECT COUNT(*) AS n FROM queue WHERE party_code = ? AND state = 'done'").get(p.code) as {
    n: number;
  };
  return {
    code: p.code,
    name: p.name,
    mode: p.mode,
    theme: THEME_IDS.includes(p.theme) ? p.theme : 'classic',
    signupsOpen: !!p.signups_open,
    current: currentRow ? toEntry(currentRow) : null,
    queue: rows.filter((r) => r.state === 'queued').map(toEntry),
    status: currentRow ? p.status : 'idle',
    seq: p.seq,
    command: p.command,
    playlistSongIds: playlist.map((r) => r.song_id),
    songsSung: sung.n,
  };
}

/** Songs guests may pick from: the curated playlist, or the whole catalog in open mode. */
export function partySongs(code: string): Song[] {
  const p = partyRow(code);
  if (p.mode === 'open') return listSongs();
  const ids = new Set(
    (db.prepare('SELECT song_id FROM party_songs WHERE party_code = ?').all(p.code) as { song_id: string }[]).map(
      (r) => r.song_id,
    ),
  );
  return listSongs().filter((s) => ids.has(s.id));
}

function songAvailable(p: PartyRow, songId: string) {
  if (!getSong(songId)) return false;
  if (p.mode === 'open') return true;
  return !!db.prepare('SELECT 1 FROM party_songs WHERE party_code = ? AND song_id = ?').get(p.code, songId);
}

/* --------------------------------------------------------------- writes */

export function createParty(
  name: string,
  mode: PartyMode,
  opts: { ownerId?: string | null; songIds?: string[]; theme?: PartyTheme } = {},
): CreatePartyResponse {
  const partyName = String(name ?? '').trim().slice(0, 60) || 'Karaoke Night';
  const cleanMode: PartyMode = mode === 'curated' ? 'curated' : 'open';
  const code = newCode();
  const hostToken = randomToken();
  const stageToken = randomToken();
  const theme = opts.theme && THEME_IDS.includes(opts.theme) ? opts.theme : 'classic';
  tx(() => {
    db.prepare(
      `INSERT INTO parties (code, name, mode, host_token, stage_token, created_at, owner_id, theme) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(code, partyName, cleanMode, hostToken, stageToken, Date.now(), opts.ownerId ?? null, theme);
    for (const id of opts.songIds ?? []) {
      if (getSong(id)) db.prepare('INSERT OR IGNORE INTO party_songs (party_code, song_id) VALUES (?, ?)').run(code, id);
    }
  });
  return { code, hostToken, stageToken };
}

export function updateParty(
  code: string,
  patch: { name?: string; mode?: PartyMode; signupsOpen?: boolean; theme?: PartyTheme },
) {
  const p = partyRow(code);
  const name = patch.name !== undefined ? String(patch.name).trim().slice(0, 60) || p.name : p.name;
  const mode = patch.mode === 'curated' || patch.mode === 'open' ? patch.mode : p.mode;
  const open = patch.signupsOpen !== undefined ? (patch.signupsOpen ? 1 : 0) : p.signups_open;
  const theme = patch.theme && THEME_IDS.includes(patch.theme) ? patch.theme : p.theme;
  db.prepare('UPDATE parties SET name = ?, mode = ?, signups_open = ?, theme = ? WHERE code = ?').run(
    name,
    mode,
    open,
    theme,
    p.code,
  );
  notify(p.code);
}

export function addToPlaylist(code: string, songIds: string[]) {
  const p = partyRow(code);
  tx(() => {
    for (const id of songIds ?? []) {
      if (getSong(id)) db.prepare('INSERT OR IGNORE INTO party_songs (party_code, song_id) VALUES (?, ?)').run(p.code, id);
    }
  });
  notify(p.code);
}

export function removeFromPlaylist(code: string, songId: string) {
  const p = partyRow(code);
  db.prepare('DELETE FROM party_songs WHERE party_code = ? AND song_id = ?').run(p.code, songId);
  notify(p.code);
}

export function replacePlaylist(code: string, songIds: string[]) {
  const p = partyRow(code);
  tx(() => {
    db.prepare('DELETE FROM party_songs WHERE party_code = ?').run(p.code);
    for (const id of Array.isArray(songIds) ? songIds : []) {
      if (typeof id === 'string' && getSong(id))
        db.prepare('INSERT OR IGNORE INTO party_songs (party_code, song_id) VALUES (?, ?)').run(p.code, id);
    }
  });
  notify(p.code);
}

export function partyOwner(code: string): string | null {
  return partyRow(code).owner_id;
}

export function hostCredentials(code: string) {
  const p = partyRow(code);
  return { hostToken: p.host_token, stageToken: p.stage_token };
}

export function claimParty(code: string, userId: string) {
  const p = partyRow(code);
  if (p.owner_id && p.owner_id !== userId) throw new HttpError(409, 'This party belongs to another account.');
  db.prepare('UPDATE parties SET owner_id = ? WHERE code = ?').run(userId, p.code);
}

export function deleteParty(code: string) {
  db.prepare('DELETE FROM parties WHERE code = ?').run(partyRow(code).code);
}

/**
 * Is `name` already used by a different guest at this party? Counts anyone who has
 * signed up tonight (queued, singing or already sung), including host-added singers.
 */
export function nameTakenAtParty(code: string, name: string, guestId: string | null): boolean {
  const key = nameKey(name);
  const rows = db
    .prepare("SELECT singer, guest_id FROM queue WHERE party_code = ? AND state IN ('queued','current','done')")
    .all(code) as { singer: string; guest_id: string | null }[];
  return rows.some((r) => nameKey(r.singer) === key && (guestId === null || r.guest_id !== guestId));
}

/**
 * Change a guest's display name everywhere they're signed up tonight. Throws if another guest
 * at any of those parties already uses the name. Returns the affected party codes.
 */
export function renameGuest(guestId: string, name: string): string[] {
  const parties = (
    db
      .prepare("SELECT DISTINCT party_code FROM queue WHERE guest_id = ? AND state IN ('queued','current','done')")
      .all(guestId) as { party_code: string }[]
  ).map((r) => r.party_code);
  for (const code of parties) {
    if (nameTakenAtParty(code, name, guestId))
      throw new HttpError(409, `Someone here is already using the name "${name}". Add an initial or use a nickname.`);
  }
  const changed = (
    db
      .prepare("SELECT DISTINCT party_code FROM queue WHERE guest_id = ? AND state IN ('queued','current') AND singer != ?")
      .all(guestId, name) as { party_code: string }[]
  ).map((r) => r.party_code);
  db.prepare("UPDATE queue SET singer = ? WHERE guest_id = ? AND state IN ('queued','current')").run(name, guestId);
  return changed;
}

function setPlayback(code: string, status: PlaybackStatus, command: 'restart' | null = null) {
  db.prepare('UPDATE parties SET status = ?, command = ?, seq = seq + 1 WHERE code = ?').run(status, command, code);
}

function currentId(code: string): string | null {
  const row = db.prepare("SELECT id FROM queue WHERE party_code = ? AND state = 'current'").get(code) as
    | { id: string }
    | undefined;
  return row?.id ?? null;
}

/** Move the next queued entry onto the stage (in the 'ready' state), or go idle. */
function promoteNext(code: string) {
  const next = db
    .prepare("SELECT id FROM queue WHERE party_code = ? AND state = 'queued' ORDER BY position LIMIT 1")
    .get(code) as { id: string } | undefined;
  if (next) {
    db.prepare("UPDATE queue SET state = 'current' WHERE id = ?").run(next.id);
    setPlayback(code, 'ready');
  } else {
    setPlayback(code, 'idle');
  }
}

function advance(code: string) {
  db.prepare("UPDATE queue SET state = 'done' WHERE party_code = ? AND state = 'current'").run(code);
  promoteNext(code);
}

/**
 * Sign someone up. Guests (asHost = false) must identify with their device id, can't pick a
 * song that's already queued or playing, and can't use a name another guest is using.
 * The host can add any singer/song (e.g. on behalf of someone without a phone).
 */
export function addEntry(
  code: string,
  input: { songId: string; singer: string; guestId?: string | null },
  asHost = false,
) {
  const p = partyRow(code);
  if (!p.signups_open && !asHost) throw new HttpError(403, 'The host has paused sign-ups.');
  const singer = cleanName(input.singer);
  if (!singer) throw new HttpError(400, 'Enter your name.');
  if (!songAvailable(p, input.songId)) throw new HttpError(400, "That song isn't available at this party.");
  const guestId = asHost ? null : typeof input.guestId === 'string' && /^[a-f0-9]{32}$/.test(input.guestId) ? input.guestId : null;
  if (!asHost && !guestId) throw new HttpError(400, 'Reload the page and try again.');

  if (!asHost) {
    if (
      db
        .prepare("SELECT 1 FROM queue WHERE party_code = ? AND song_id = ? AND state IN ('queued','current')")
        .get(p.code, input.songId)
    ) {
      throw new HttpError(409, 'That song is already in the queue.');
    }
    if (nameTakenAtParty(p.code, singer, guestId)) {
      throw new HttpError(409, `Someone here is already using the name "${singer}". Add an initial or use a nickname.`);
    }
  }

  // Signing up under a new name renames the guest's other spots too (one guest = one name).
  let renamedIn: string[] = [];
  if (guestId) {
    const prev = db.prepare('SELECT name FROM guests WHERE id = ?').get(guestId) as { name: string } | undefined;
    if (prev?.name && prev.name !== singer) renamedIn = renameGuest(guestId, singer);
  }

  const id = randomId();
  tx(() => {
    const { pos } = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS pos FROM queue WHERE party_code = ?').get(p.code) as {
      pos: number;
    };
    db.prepare(
      `INSERT INTO queue (id, party_code, song_id, singer, guest_id, position, state, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)`,
    ).run(id, p.code, input.songId, singer, guestId, pos, Date.now());
    if (guestId) {
      // Remember the name on the guest's profile (first sign-up creates it).
      db.prepare(
        `INSERT INTO guests (id, name, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
      ).run(guestId, singer, Date.now());
    }
    if (!currentId(p.code)) promoteNext(p.code);
  });
  for (const c of new Set([p.code, ...renamedIn])) notify(c);
  return { id };
}

export function removeEntry(code: string, entryId: string, who: { host: boolean; guestId?: string | null }) {
  const p = partyRow(code);
  const row = db.prepare('SELECT * FROM queue WHERE id = ? AND party_code = ?').get(entryId, p.code) as
    | { state: string; guest_id: string | null }
    | undefined;
  if (!row || (row.state !== 'queued' && row.state !== 'current')) throw new HttpError(404, 'That sign-up no longer exists.');
  if (!who.host && (!who.guestId || row.guest_id !== who.guestId)) {
    throw new HttpError(403, 'You can only remove your own sign-ups.');
  }
  tx(() => {
    db.prepare("UPDATE queue SET state = 'removed' WHERE id = ?").run(entryId);
    if (row.state === 'current') promoteNext(p.code);
  });
  notify(p.code);
}

export function reorderQueue(code: string, entryIds: string[]) {
  const p = partyRow(code);
  const queued = (
    db.prepare("SELECT id FROM queue WHERE party_code = ? AND state = 'queued' ORDER BY position").all(p.code) as {
      id: string;
    }[]
  ).map((r) => r.id);
  const valid = new Set(queued);
  const requested = (entryIds ?? []).filter((id, i, arr) => valid.has(id) && arr.indexOf(id) === i);
  const order = [...requested, ...queued.filter((id) => !requested.includes(id))];
  // Keep queued entries after the current one by offsetting from the current max.
  tx(() => {
    const { base } = db.prepare('SELECT COALESCE(MAX(position), 0) AS base FROM queue WHERE party_code = ?').get(p.code) as {
      base: number;
    };
    order.forEach((id, i) => db.prepare('UPDATE queue SET position = ? WHERE id = ?').run(base + 1 + i, id));
  });
  notify(p.code);
}

export function control(code: string, action: ControlAction) {
  const p = partyRow(code);
  tx(() => {
    const hasCurrent = !!currentId(p.code);
    switch (action) {
      case 'play':
        if (!hasCurrent) promoteNext(p.code);
        if (currentId(p.code)) setPlayback(p.code, 'playing');
        break;
      case 'pause':
        if (p.status === 'playing') setPlayback(p.code, 'paused');
        break;
      case 'toggle':
        if (p.status === 'playing') setPlayback(p.code, 'paused');
        else if (hasCurrent) setPlayback(p.code, 'playing');
        else {
          promoteNext(p.code);
          if (currentId(p.code)) setPlayback(p.code, 'playing');
        }
        break;
      case 'restart':
        if (hasCurrent) setPlayback(p.code, 'playing', 'restart');
        break;
      case 'next':
        advance(p.code);
        break;
      default:
        throw new HttpError(400, 'Unknown action.');
    }
  });
  notify(p.code);
}

/** The stage reports that the track finished; only advance if it's still the current entry. */
export function stageEnded(code: string, entryId: string) {
  const p = partyRow(code);
  if (currentId(p.code) !== entryId) return;
  tx(() => advance(p.code));
  notify(p.code);
}

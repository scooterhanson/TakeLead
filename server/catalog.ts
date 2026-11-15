import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, tx } from './db.ts';
import { HttpError } from './errors.ts';
import type { Song, SongSource } from '../src/shared/types.ts';

export const MEDIA_DIR = path.resolve(process.env.MEDIA_DIR ?? 'media');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

const VIDEO_EXT = new Set(['.mp4', '.m4v', '.webm', '.mov', '.ogv']);
const AUDIO_EXT = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.flac']);

interface SongRow {
  id: string;
  title: string;
  artist: string;
  source: string;
  origin: string;
  genre?: string | null;
}

export function rowToSong(r: SongRow): Song {
  return {
    id: r.id,
    title: r.title,
    artist: r.artist,
    source: JSON.parse(r.source) as SongSource,
    origin: r.origin as Song['origin'],
    genre: r.genre ?? null,
  };
}

export function listSongs(): Song[] {
  const rows = db
    .prepare('SELECT * FROM songs ORDER BY artist COLLATE NOCASE, title COLLATE NOCASE')
    .all() as unknown as SongRow[];
  return rows.map(rowToSong);
}

export function getSong(id: string): Song | null {
  const row = db.prepare('SELECT * FROM songs WHERE id = ?').get(id) as unknown as SongRow | undefined;
  return row ? rowToSong(row) : null;
}

type NewSong = Omit<Song, 'genre'>;

/**
 * Insert or refresh a song. If its raw title (video title / filename) is unchanged, keep the
 * looked-up or host-edited artist, title and genre; otherwise reset them and queue a new lookup.
 * status 'pending' = look up artist/title/genre; 'pending_genre' = names were typed by the host, only find a genre.
 */
function upsertSong(song: NewSong, rawTitle: string, status: 'pending' | 'pending_genre' = 'pending') {
  db.prepare(
    `INSERT INTO songs (id, title, artist, source, origin, added_at, raw_title, genre, meta_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
     ON CONFLICT(id) DO UPDATE SET
       source = excluded.source,
       origin = excluded.origin,
       title = CASE WHEN songs.raw_title IS excluded.raw_title THEN songs.title ELSE excluded.title END,
       artist = CASE WHEN songs.raw_title IS excluded.raw_title THEN songs.artist ELSE excluded.artist END,
       genre = CASE WHEN songs.raw_title IS excluded.raw_title THEN songs.genre ELSE NULL END,
       meta_status = CASE WHEN songs.raw_title IS excluded.raw_title THEN songs.meta_status ELSE excluded.meta_status END,
       raw_title = excluded.raw_title`,
  ).run(song.id, song.title, song.artist, JSON.stringify(song.source), song.origin, Date.now(), rawTitle, status);
}

/** Host edit of a song's details. Locks them so automatic lookups won't overwrite. */
export function updateSongMeta(id: string, patch: { title?: unknown; artist?: unknown; genre?: unknown }) {
  const song = getSong(id);
  if (!song) throw new HttpError(404, 'Song not found.');
  const clean = (v: unknown, fallback: string | null) =>
    typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, 120) || null : fallback;
  const title = clean(patch.title, song.title) ?? song.title;
  const artist = clean(patch.artist, song.artist) ?? 'Unknown Artist';
  const genre = clean(patch.genre, song.genre);
  db.prepare("UPDATE songs SET title = ?, artist = ?, genre = ?, meta_status = 'manual' WHERE id = ?").run(
    title,
    artist,
    genre,
    id,
  );
  return getSong(id)!;
}

export function deleteSong(id: string) {
  const song = getSong(id);
  if (!song) throw new HttpError(404, 'Song not found.');
  if (song.origin === 'media') throw new HttpError(400, 'This song is a file on the server. Delete the file from the media folder, then rescan.');
  if (db.prepare("SELECT 1 FROM queue WHERE song_id = ? AND state IN ('queued','current')").get(id)) {
    throw new HttpError(409, 'Someone is signed up for this song. Remove their sign-up first.');
  }
  db.prepare('DELETE FROM songs WHERE id = ?').run(id);
}

/* ---------------------------------------------------------------- media */

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/** "Artist - Title" → { artist, title }; anything else is just a title. */
export function parseArtistTitle(base: string): { artist: string; title: string } {
  const cleaned = base
    .replace(/[_]+/g, ' ')
    .replace(/\s*[|｜].*$/, '') // "Title - Artist | Karaoke Version | Channel"
    .replace(/\s*[\[(][^\])]*(karaoke|instrumental|lyrics?|backing track|vocal|official|video|audio|visuali[sz]er|remaster(ed)?|\bhd\b|\b4k\b)[^\])]*[\])]/gi, '')
    .replace(/^[^\p{L}\p{N}"“']+/u, '') // leading emoji/symbols, e.g. "🎤 Portishead - ..."
    .replace(/^\s*karaoke\s*[-–:]\s*/i, '')
    .replace(/\s*[-–]?\s*\b(karaoke|instrumental)\b( version| video)?( with lyrics)?\s*$/i, '')
    .trim();
  // 'Santeria in the Style of "Sublime"'
  const style = cleaned.match(/^(.+?)\s+in the style of\s+["“']?(.+?)["”']?$/i);
  if (style) return { artist: style[2].trim(), title: style[1].replace(/^["“']|["”']$/g, '').trim() };
  const m = cleaned.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: 'Unknown Artist', title: cleaned };
}

function lrcTags(file: string): { ti?: string; ar?: string } {
  try {
    const head = fs.readFileSync(file, 'utf8').slice(0, 2000);
    return {
      ti: head.match(/^\[ti:(.+)\]\s*$/im)?.[1].trim(),
      ar: head.match(/^\[ar:(.+)\]\s*$/im)?.[1].trim(),
    };
  } catch {
    return {};
  }
}

const mediaUrl = (abs: string) =>
  '/media/' + path.relative(MEDIA_DIR, abs).split(path.sep).map(encodeURIComponent).join('/');

/**
 * Scan MEDIA_DIR and sync media songs into the catalog.
 *   Artist - Title.mp4                       → karaoke video
 *   Artist - Title.mp3 + Artist - Title.lrc  → audio + timed lyrics
 */
export function scanMedia(): { total: number } {
  const groups = new Map<string, { video?: string; audio?: string; lrc?: string }>();
  for (const file of walk(MEDIA_DIR)) {
    const ext = path.extname(file).toLowerCase();
    const key = file.slice(0, -ext.length);
    const g = groups.get(key) ?? {};
    if (VIDEO_EXT.has(ext)) g.video = file;
    else if (AUDIO_EXT.has(ext)) g.audio = file;
    else if (ext === '.lrc') g.lrc = file;
    else continue;
    groups.set(key, g);
  }

  const seen: string[] = [];
  tx(() => {
    for (const [key, g] of groups) {
      let source: SongSource;
      if (g.video) source = { kind: 'video', url: mediaUrl(g.video) };
      else if (g.audio && g.lrc) source = { kind: 'lrc', audioUrl: mediaUrl(g.audio), lrcUrl: mediaUrl(g.lrc) };
      else continue;

      let { artist, title } = parseArtistTitle(path.basename(key));
      if (g.lrc) {
        const tags = lrcTags(g.lrc);
        title = tags.ti ?? title;
        artist = tags.ar ?? artist;
      }
      const rel = path.relative(MEDIA_DIR, key);
      const id = 'm_' + crypto.createHash('sha1').update(rel).digest('hex').slice(0, 16);
      upsertSong({ id, title, artist, source, origin: 'media' }, `${artist} - ${title}`);
      seen.push(id);
    }
    // Drop media songs whose files disappeared.
    const existing = db.prepare("SELECT id FROM songs WHERE origin = 'media'").all() as { id: string }[];
    const keep = new Set(seen);
    for (const { id } of existing) if (!keep.has(id)) db.prepare('DELETE FROM songs WHERE id = ?').run(id);
  });
  return { total: seen.length };
}

/* -------------------------------------------------------------- youtube */

export function parseYouTubeId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    let id: string | null = null;
    if (u.hostname.endsWith('youtu.be')) id = u.pathname.slice(1, 12);
    else if (u.searchParams.get('v')) id = u.searchParams.get('v');
    else id = u.pathname.match(/\/(?:embed|shorts|live|v)\/([\w-]{11})/)?.[1] ?? null;
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Look up a video via YouTube's public oEmbed endpoint (no API key). Also tells us if it's embeddable. */
async function youTubeOEmbed(
  videoId: string,
): Promise<{ ok: true; title: string; channel: string } | { ok: false; reason: string }> {
  try {
    const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + videoId)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'owner blocks playback outside YouTube' };
    if (res.status === 404 || res.status === 400) return { ok: false, reason: 'private or removed' };
    if (!res.ok) return { ok: false, reason: `lookup failed (${res.status})` };
    const data = (await res.json()) as { title?: string; author_name?: string };
    return data.title ? { ok: true, title: data.title, channel: data.author_name ?? '' } : { ok: false, reason: 'no title found' };
  } catch {
    return { ok: false, reason: 'YouTube did not respond' };
  }
}

/** Channels known to title videos "Title - Artist" rather than "Artist - Title". */
const TITLE_FIRST_CHANNELS = /karafun/i;

function parseVideoTitle(title: string, channel: string) {
  const parsed = parseArtistTitle(title);
  if (TITLE_FIRST_CHANNELS.test(channel) && parsed.artist !== 'Unknown Artist') {
    return { artist: parsed.title, title: parsed.artist };
  }
  return parsed;
}

export function parseYouTubePlaylistId(input: string): string | null {
  try {
    const list = new URL(input.trim()).searchParams.get('list');
    return list && /^[\w-]{10,64}$/.test(list) ? list : null;
  } catch {
    return /^(PL|OL|UU|FL|RD)[\w-]{8,62}$/.test(input.trim()) ? input.trim() : null;
  }
}

/** Confirm a playlist exists and is viewable (public/unlisted) and get its title, via oEmbed. */
export async function youTubePlaylistInfo(listId: string): Promise<{ title: string }> {
  if (!/^[\w-]{10,64}$/.test(listId)) throw new HttpError(400, "That isn't a YouTube playlist link.");
  let res: Response;
  try {
    const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/playlist?list=' + listId)}`;
    res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  } catch {
    throw new HttpError(502, "Couldn't reach YouTube. Try again.");
  }
  if (res.status === 404 || res.status === 400 || res.status === 401 || res.status === 403)
    throw new HttpError(404, "Couldn't open that playlist. It must be public or unlisted.");
  if (!res.ok) throw new HttpError(502, `YouTube returned an error (${res.status}). Try again.`);
  const data = (await res.json()) as { title?: string };
  return { title: data.title ?? 'YouTube playlist' };
}

/** Run fn over items with limited concurrency. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export const MAX_PLAYLIST_IMPORT = 500;

/** Add many YouTube videos (e.g. from a playlist) to the catalog. Unplayable videos are skipped. */
export async function importYouTubeVideos(videoIds: unknown) {
  if (!Array.isArray(videoIds)) throw new HttpError(400, 'videoIds must be a list');
  const ids = [...new Set(videoIds.filter((v): v is string => typeof v === 'string' && /^[\w-]{11}$/.test(v)))];
  if (ids.length === 0) throw new HttpError(400, 'That playlist has no videos.');
  if (ids.length > MAX_PLAYLIST_IMPORT) throw new HttpError(400, `Playlists can have at most ${MAX_PLAYLIST_IMPORT} videos.`);

  const songIds: string[] = [];
  let added = 0;
  let existing = 0;
  const skipped: { videoId: string; reason: string }[] = [];

  await mapLimit(ids, 6, async (videoId) => {
    const id = 'yt_' + videoId;
    if (getSong(id)) {
      existing++;
      songIds.push(id);
      return;
    }
    const r = await youTubeOEmbed(videoId);
    if (!r.ok) return void skipped.push({ videoId, reason: r.reason });
    const { artist, title } = parseVideoTitle(r.title, r.channel);
    upsertSong({ id, title, artist, source: { kind: 'youtube', videoId }, origin: 'youtube' }, r.title);
    added++;
    songIds.push(id);
  });

  // Preserve playlist order for the caller.
  const order = new Map(ids.map((v, i) => [`yt_${v}`, i]));
  songIds.sort((a, b) => order.get(a)! - order.get(b)!);
  return { songIds, added, existing, skipped };
}

export async function addYouTubeSong(input: { url: string; title?: string; artist?: string }): Promise<Song> {
  const videoId = parseYouTubeId(input.url ?? '');
  if (!videoId) throw new HttpError(400, "That isn't a YouTube video link.");
  let title = input.title?.trim().slice(0, 120) || '';
  let artist = input.artist?.trim().slice(0, 120) || '';
  let rawTitle: string;
  let status: 'pending' | 'pending_genre' = 'pending_genre';
  if (title) {
    rawTitle = `${artist} - ${title}`;
  } else {
    const r = await youTubeOEmbed(videoId);
    if (!r.ok) throw new HttpError(400, `Couldn't add that video (${r.reason}).`);
    const parsed = parseVideoTitle(r.title, r.channel);
    title = parsed.title;
    if (!artist) {
      artist = parsed.artist;
      status = 'pending';
    }
    rawTitle = r.title;
  }
  const id = 'yt_' + videoId;
  upsertSong({ id, title, artist: artist || 'Unknown Artist', source: { kind: 'youtube', videoId }, origin: 'youtube' }, rawTitle, status);
  return getSong(id)!;
}

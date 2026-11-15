/**
 * Background metadata lookup. For each new song, search the iTunes Search API (free, no key)
 * using the artist/title inferred from the video title or filename. A result is accepted only
 * if its artist and song title both appear in that original title, so tributes and covers don't
 * get mislabeled. A confirmed match supplies a genre and also fixes artist/title naming.
 *
 * iTunes allows roughly 20 requests per minute, so lookups are spaced out and
 * persisted. A big playlist import fills in over a few minutes.
 */
import { db } from './db.ts';
import { parseArtistTitle } from './catalog.ts';

const SPACING_MS = 3100;
const BACKOFF_MS = 60_000;
const USER_AGENT = 'TakeLead/0.1 (self-hosted karaoke party app)';

interface PendingRow {
  id: string;
  title: string;
  artist: string;
  raw_title: string | null;
  meta_status: 'pending' | 'pending_genre';
}

interface ITunesTrack {
  artistName: string;
  trackName: string;
  primaryGenreName?: string;
}

let onChange: () => void = () => {};
export function onCatalogEnriched(fn: () => void) {
  onChange = fn;
}

/* ------------------------------------------------------------ matching */

export function norm(s: string) {
  return ` ${s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`.]/g, '') // "R.E.M." ≈ "REM", "Don't" ≈ "Dont"
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^the /, '')
    .trim()} `;
}

/** "Akon featuring Eminem" → "Akon"; keeps duos like "Simon & Garfunkel". */
const stripFeatured = (artist: string) => artist.replace(/\s+(feat\.?|featuring|ft\.?|with)\s+.*$/i, '').trim();

/** "Smack That (feat. Eminem)" / "Loser - 2015 Remaster" → core title. */
const coreTitle = (title: string) =>
  title
    .replace(/\s*[([][^)\]]*[)\]]/g, '')
    .replace(/\s+-\s+.*(remaster|version|edit|mix|live|mono|stereo).*$/i, '')
    .trim();

function matches(track: ITunesTrack, haystack: string) {
  const title = norm(coreTitle(track.trackName));
  if (title.trim().length < 2 || !haystack.includes(title)) return false;
  // The artist must appear somewhere other than the song title itself, so an act literally
  // named "Happy Birthday" doesn't match the song "Happy Birthday".
  const rest = haystack.replaceAll(title, ' | ');
  const artist = norm(stripFeatured(track.artistName));
  const firstArtist = norm(stripFeatured(track.artistName).split(/\s+(?:&|and|x|,)\s+/i)[0]);
  return rest.includes(artist) || (firstArtist.trim().length > 2 && rest.includes(firstArtist));
}

/** Genre names from iTunes, tidied for a party song list. */
function tidyGenre(g: string | undefined): string | null {
  if (!g) return null;
  const map: Record<string, string> = {
    'Hip-Hop/Rap': 'Hip-Hop',
    'R&B/Soul': 'R&B / Soul',
    "Children's Music": 'Kids',
    'Singer/Songwriter': 'Singer-Songwriter',
    'Hard Rock': 'Rock',
    'Heavy Metal': 'Metal',
    Soundtrack: 'Soundtrack',
    'Christian & Gospel': 'Gospel',
    'Pop Latino': 'Latin',
    'Urbano latino': 'Latin',
  };
  if (/^(christmas|holiday)/i.test(g)) return 'Holiday';
  return map[g] ?? g;
}

async function searchITunes(term: string): Promise<ITunesTrack[] | 'rate-limited'> {
  const url = `https://itunes.apple.com/search?${new URLSearchParams({ term, entity: 'song', limit: '8' })}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(10000) });
  if (res.status === 403 || res.status === 429) return 'rate-limited';
  if (!res.ok) throw new Error(`iTunes ${res.status}`);
  const data = (await res.json()) as { results?: ITunesTrack[] };
  return data.results ?? [];
}

/** Strip karaoke/upload filler words that hurt search relevance. */
function searchTerm(s: string) {
  return s
    .replace(/[^\p{L}\p{N}'’&\s-]+/gu, ' ')
    .replace(/\b(karaoke|king of karaoke|hd|4k|lyrics?|instrumental|version|official|video|audio|no lead vocal|backing track)\b/gi, ' ')
    .replace(/\s+-\s+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ------------------------------------------------------------- worker */

let running = false;
let wake: (() => void) | null = null;
const sleep = (ms: number) =>
  new Promise<void>((r) => {
    const t = setTimeout(r, ms);
    wake = () => {
      clearTimeout(t);
      r();
    };
  });

export function pendingCount(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM songs WHERE meta_status IN ('pending','pending_genre')").get() as { n: number }).n;
}

/** Nudge the worker after songs are added. */
export function kickEnrichment() {
  if (running) wake?.();
  else void runWorker();
}

async function runWorker() {
  running = true;
  let sinceNotify = 0;
  try {
    for (;;) {
      const row = db
        .prepare(
          "SELECT id, title, artist, raw_title, meta_status FROM songs WHERE meta_status IN ('pending','pending_genre') ORDER BY added_at, id LIMIT 1",
        )
        .get() as PendingRow | undefined;
      if (!row) break;

      const known = row.artist && row.artist !== 'Unknown Artist';
      // Songs added before raw titles were stored: rebuild one from the names we have.
      const raw = row.raw_title ?? (known ? `${row.artist} - ${row.title}` : row.title);
      const parsed = parseArtistTitle(raw);
      const terms = [
        searchTerm(known ? `${row.artist} ${row.title}` : parsed.title),
        // Fallback: only the part before any " - " in the title (drops "- Tribute", "- King Of Karaoke", ...).
        searchTerm(known ? `${row.artist} ${row.title.split(/\s+[-–]\s+/)[0]}` : parsed.title.split(/\s+[-–]\s+/)[0]),
      ].filter((t, i, a) => t.length > 1 && a.indexOf(t) === i);

      // Match against the original title (for host-typed songs, raw is "Artist - Title").
      const haystack = norm(raw);
      let hit: ITunesTrack | undefined;
      let rateLimited = false;
      for (const [i, term] of terms.entries()) {
        if (i > 0) await sleep(SPACING_MS);
        let results: ITunesTrack[] | 'rate-limited';
        try {
          results = await searchITunes(term);
        } catch (err) {
          console.warn(`[genres] lookup failed for "${term}": ${(err as Error).message}`);
          results = [];
        }
        if (results === 'rate-limited') {
          rateLimited = true;
          break;
        }
        hit = results.find((t) => matches(t, haystack));
        if (hit) break;
      }
      if (rateLimited) {
        console.warn('[genres] iTunes rate limit hit; pausing a minute');
        await sleep(BACKOFF_MS);
        continue;
      }

      const current = db.prepare('SELECT meta_status FROM songs WHERE id = ?').get(row.id) as { meta_status: string } | undefined;
      if (current?.meta_status === row.meta_status) {
        if (hit && row.meta_status === 'pending') {
          db.prepare("UPDATE songs SET artist = ?, title = ?, genre = ?, meta_status = 'matched' WHERE id = ?").run(
            stripFeatured(hit.artistName),
            coreTitle(hit.trackName) || hit.trackName,
            tidyGenre(hit.primaryGenreName),
            row.id,
          );
        } else if (hit) {
          db.prepare("UPDATE songs SET genre = ?, meta_status = 'matched' WHERE id = ?").run(tidyGenre(hit.primaryGenreName), row.id);
        } else {
          db.prepare("UPDATE songs SET meta_status = 'unmatched' WHERE id = ?").run(row.id);
        }
      }

      if (++sinceNotify >= 5) {
        sinceNotify = 0;
        onChange();
      }
      await sleep(SPACING_MS);
    }
  } finally {
    running = false;
    wake = null;
    onChange();
  }
}

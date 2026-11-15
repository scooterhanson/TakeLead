import type { Song } from '../shared/types.ts';

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={`logo-wrap ${small ? 'logo-wrap-small' : ''}`}>
      <img className="logo-icon" src="/logo-only.png" alt="" />
      <span className={`logo ${small ? 'logo-small' : ''}`}>TakeLead</span>
    </span>
  );
}

export const sourceLabel = (s: Song) =>
  s.source.kind === 'youtube' ? 'YouTube' : s.source.kind === 'video' ? 'Video' : 'Lyrics';

export function SourceBadge({ song }: { song: Song }) {
  return <span className={`badge badge-${song.source.kind}`}>{sourceLabel(song)}</span>;
}

export function matchesSearch(song: Song, q: string) {
  if (!q.trim()) return true;
  const hay = `${song.title} ${song.artist} ${song.genre ?? ''}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => hay.includes(t));
}

export function formatTime(s: number) {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

/* -------------------------------------------------------------- sorting */

export type SongSort = 'artist' | 'title' | 'genre';

export const SONG_SORTS: { key: SongSort; label: string }[] = [
  { key: 'artist', label: 'Artist' },
  { key: 'title', label: 'Song' },
  { key: 'genre', label: 'Genre' },
];

/** Sort key that ignores a leading "The"/"A"/"An" and punctuation, so "The Beatles" files under B. */
const sortKey = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^\s*(the|a|an)\s+/i, '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .toLowerCase();

const cmp = (a: string, b: string) => sortKey(a).localeCompare(sortKey(b), undefined, { numeric: true });

const letterOf = (s: string) => {
  const c = sortKey(s).charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : '#';
};

export const UNKNOWN_GENRE = 'Other';

export interface SongGroup {
  label: string;
  songs: Song[];
}

/** Sort songs and split them into labeled sections (A–Z letters, or genres). */
export function groupSongs(songs: Song[], sort: SongSort): SongGroup[] {
  const sorted = [...songs].sort((a, b) => {
    if (sort === 'title') return cmp(a.title, b.title) || cmp(a.artist, b.artist);
    if (sort === 'genre') {
      const ga = a.genre ?? '￿';
      const gb = b.genre ?? '￿'; // unknown genre last
      return ga.localeCompare(gb) || cmp(a.artist, b.artist) || cmp(a.title, b.title);
    }
    return cmp(a.artist, b.artist) || cmp(a.title, b.title);
  });
  const groups: SongGroup[] = [];
  for (const song of sorted) {
    const label =
      sort === 'genre' ? (song.genre ?? UNKNOWN_GENRE) : letterOf(sort === 'title' ? song.title : song.artist);
    const last = groups.at(-1);
    if (last && last.label === label) last.songs.push(song);
    else groups.push({ label, songs: [song] });
  }
  return groups;
}

export function SortControl({ value, onChange }: { value: SongSort; onChange: (s: SongSort) => void }) {
  return (
    <div className="sort-control" role="radiogroup" aria-label="Sort songs by">
      <span className="muted small">Sort</span>
      {SONG_SORTS.map((s) => (
        <button
          key={s.key}
          type="button"
          role="radio"
          aria-checked={value === s.key}
          className={value === s.key ? 'active' : ''}
          onClick={() => onChange(s.key)}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

export function GenreTag({ song }: { song: Song }) {
  return song.genre ? <span className="genre-tag">{song.genre}</span> : null;
}

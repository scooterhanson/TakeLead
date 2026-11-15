/** Types shared by the server and the browser client. */

export type SongSource =
  /** An embeddable YouTube karaoke video. */
  | { kind: 'youtube'; videoId: string }
  /** A self-hosted karaoke video (lyrics burned in), e.g. MP4/WebM in media/. */
  | { kind: 'video'; url: string }
  /** A self-hosted audio track plus an LRC timed-lyrics file rendered by the app. */
  | { kind: 'lrc'; audioUrl: string; lrcUrl: string };

export interface Song {
  id: string;
  title: string;
  artist: string;
  source: SongSource;
  origin: 'media' | 'youtube';
  /** Inferred from an online music catalog, or set by the host. null = unknown. */
  genre: string | null;
}

export type PartyMode = 'curated' | 'open';

export type PartyTheme = 'classic' | 'light' | 'dark' | 'sixties' | 'seventies' | 'eighties' | 'win95' | 'winxp';

export const THEMES: { id: PartyTheme; label: string }[] = [
  { id: 'classic', label: 'Classic' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'sixties', label: 'Retro (60s)' },
  { id: 'seventies', label: 'Retro (70s)' },
  { id: 'eighties', label: 'Retro (80s)' },
  { id: 'win95', label: 'Retro (90s · Windows 95)' },
  { id: 'winxp', label: "Retro ('00s · Windows XP)" },
];

export interface GuestProfile {
  name: string;
  blurb: string;
  avatarUrl: string | null;
}

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface SavedPlaylist {
  id: string;
  name: string;
  songIds: string[];
  updatedAt: number;
}

export interface AccountParty {
  code: string;
  name: string;
  theme: PartyTheme;
  createdAt: number;
  songsSung: number;
  queued: number;
}

export interface MeResponse {
  user: User | null;
  parties: AccountParty[];
  playlists: SavedPlaylist[];
}

/**
 * idle    – nothing queued
 * ready   – a singer is up; the stage shows their intro card and waits for Play
 * playing – the track is running
 * paused  – the track is paused
 */
export type PlaybackStatus = 'idle' | 'ready' | 'playing' | 'paused';

export interface QueueEntry {
  id: string;
  singer: string;
  /** From the guest's profile (null for host-added singers or guests without one). */
  avatarUrl: string | null;
  blurb: string | null;
  song: Song;
  createdAt: number;
}

export interface PartyState {
  code: string;
  name: string;
  mode: PartyMode;
  theme: PartyTheme;
  signupsOpen: boolean;
  current: QueueEntry | null;
  queue: QueueEntry[];
  status: PlaybackStatus;
  /** Bumped on every playback change; with `command` it signals one-shot actions. */
  seq: number;
  command: 'restart' | null;
  playlistSongIds: string[];
  songsSung: number;
}

export interface Progress {
  entryId: string;
  time: number;
  duration: number;
}

export type ControlAction = 'play' | 'pause' | 'toggle' | 'restart' | 'next';

export interface CreatePartyResponse {
  code: string;
  hostToken: string;
  stageToken: string;
}

export interface AppConfig {
  lanAddresses: string[];
  publicUrl: string | null;
  allowRegistration: boolean;
  requireAccountToHost: boolean;
}

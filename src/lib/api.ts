import type {
  AppConfig,
  ControlAction,
  CreatePartyResponse,
  GuestProfile,
  MeResponse,
  PartyMode,
  PartyState,
  PartyTheme,
  SavedPlaylist,
  Song,
  User,
} from '../shared/types.ts';

async function request<T>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const isBlob = body instanceof Blob;
  const res = await fetch(url, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': isBlob ? (body as Blob).type : 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : isBlob ? (body as Blob) : JSON.stringify(body),
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
  return data as T;
}

const p = (code: string) => `/api/parties/${encodeURIComponent(code)}`;

export const api = {
  config: () => request<AppConfig>('GET', '/api/config'),
  createParty: (name: string, mode: PartyMode, playlistId?: string) =>
    request<CreatePartyResponse>('POST', '/api/parties', { name, mode, playlistId }),
  party: (code: string) => request<PartyState>('GET', p(code)),
  songs: (code: string) => request<Song[]>('GET', `${p(code)}/songs`),
  signUp: (code: string, songId: string, singer: string, guestId: string) =>
    request<{ id: string }>('POST', `${p(code)}/queue`, { songId, singer, guestId }),
  cancel: (code: string, entryId: string, guestId: string) =>
    request<null>('DELETE', `${p(code)}/queue/${entryId}`, undefined, { 'x-guest-id': guestId }),

  // Guest profile (identified by the device's guest id)
  profile: (guestId: string) => request<GuestProfile>('GET', '/api/guests/me', undefined, { 'x-guest-id': guestId }),
  saveProfile: (guestId: string, patch: { name?: string; blurb?: string }) =>
    request<GuestProfile>('PUT', '/api/guests/me', patch, { 'x-guest-id': guestId }),
  uploadAvatar: (guestId: string, image: Blob) =>
    request<GuestProfile>('PUT', '/api/guests/me/avatar', image, { 'x-guest-id': guestId }),
  removeAvatar: (guestId: string) =>
    request<GuestProfile>('DELETE', '/api/guests/me/avatar', undefined, { 'x-guest-id': guestId }),

  // Host accounts (session cookie)
  me: () => request<MeResponse>('GET', '/api/me'),
  register: (email: string, password: string, name: string) =>
    request<{ user: User }>('POST', '/api/auth/register', { email, password, name }),
  login: (email: string, password: string) => request<{ user: User }>('POST', '/api/auth/login', { email, password }),
  logout: () => request<null>('POST', '/api/auth/logout'),
  forgotPassword: (email: string) => request<{ ok: boolean }>('POST', '/api/auth/forgot', { email }),
  resetPassword: (token: string, password: string) =>
    request<{ user: User }>('POST', '/api/auth/reset', { token, password }),
  partyCredentials: (code: string) =>
    request<{ hostToken: string; stageToken: string }>('GET', `/api/me/parties/${encodeURIComponent(code)}/credentials`),
  deleteParty: (code: string) => request<null>('DELETE', `/api/me/parties/${encodeURIComponent(code)}`),
  createPlaylist: (name: string, songIds: string[]) => request<SavedPlaylist>('POST', '/api/me/playlists', { name, songIds }),
  updatePlaylist: (id: string, patch: { name?: string; songIds?: string[] }) =>
    request<SavedPlaylist>('PUT', `/api/me/playlists/${id}`, patch),
  deletePlaylist: (id: string) => request<null>('DELETE', `/api/me/playlists/${id}`),
};

/** Host-only calls, authenticated with the party's host token. */
export function hostApi(code: string, token: string) {
  const h = { 'x-host-token': token };
  return {
    check: () => request<{ ok: boolean }>('GET', `${p(code)}/host-check`, undefined, h),
    update: (patch: { name?: string; mode?: PartyMode; signupsOpen?: boolean; theme?: PartyTheme }) =>
      request<PartyState>('PATCH', p(code), patch, h),
    control: (action: ControlAction) => request<PartyState>('POST', `${p(code)}/control`, { action }, h),
    reorder: (entryIds: string[]) => request<PartyState>('POST', `${p(code)}/queue/reorder`, { entryIds }, h),
    remove: (entryId: string) => request<null>('DELETE', `${p(code)}/queue/${entryId}`, undefined, h),
    addSinger: (songId: string, singer: string) =>
      request<{ id: string }>('POST', `${p(code)}/queue`, { songId, singer, asHost: true }, h),
    replacePlaylist: (songIds: string[]) => request<PartyState>('PUT', `${p(code)}/playlist`, { songIds }, h),
    hideProfile: (entryId: string) => request<PartyState>('POST', `${p(code)}/queue/${entryId}/hide-profile`, undefined, h),
    claim: () => request<{ ok: boolean }>('POST', `${p(code)}/claim`, undefined, h),
    addToPlaylist: (songIds: string[]) => request<PartyState>('POST', `${p(code)}/playlist`, { songIds }, h),
    removeFromPlaylist: (songId: string) => request<PartyState>('DELETE', `${p(code)}/playlist/${songId}`, undefined, h),
    catalog: () => request<Song[]>('GET', `${p(code)}/catalog`, undefined, h),
    addYouTube: (url: string, title: string, artist: string) =>
      request<Song>('POST', `${p(code)}/catalog/youtube`, { url, title, artist }, h),
    playlistInfo: (listId: string) =>
      request<{ title: string }>('GET', `${p(code)}/catalog/youtube-playlist/${encodeURIComponent(listId)}`, undefined, h),
    importYouTubeVideos: (videoIds: string[]) =>
      request<{ songIds: string[]; added: number; existing: number; skipped: { videoId: string; reason: string }[] }>(
        'POST',
        `${p(code)}/catalog/youtube-playlist`,
        { videoIds },
        h,
      ),
    catalogStatus: () => request<{ pendingLookups: number }>('GET', `${p(code)}/catalog/status`, undefined, h),
    updateSong: (songId: string, patch: { title: string; artist: string; genre: string }) =>
      request<Song>('PATCH', `${p(code)}/catalog/${songId}`, patch, h),
    rescan: () => request<{ total: number }>('POST', `${p(code)}/catalog/rescan`, undefined, h),
    deleteSong: (songId: string) => request<null>('DELETE', `${p(code)}/catalog/${songId}`, undefined, h),
  };
}
export type HostApi = ReturnType<typeof hostApi>;

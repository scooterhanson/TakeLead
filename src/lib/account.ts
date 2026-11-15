import { useCallback, useEffect, useState } from 'react';
import { api } from './api.ts';
import type { MeResponse } from '../shared/types.ts';

/* Shared signed-in state: one fetch, every component that uses useAccount() stays in sync. */
let cache: MeResponse | null = null;
let inflight: Promise<MeResponse> | null = null;
const listeners = new Set<(m: MeResponse) => void>();

export async function refreshAccount(): Promise<MeResponse> {
  inflight ??= api
    .me()
    .catch(() => ({ user: null, parties: [], playlists: [] }) as MeResponse)
    .finally(() => (inflight = null));
  const me = await inflight;
  cache = me;
  listeners.forEach((l) => l(me));
  return me;
}

export function useAccount() {
  const [me, setMe] = useState<MeResponse | null>(cache);
  useEffect(() => {
    listeners.add(setMe);
    if (!cache) refreshAccount();
    return () => {
      listeners.delete(setMe);
    };
  }, []);
  const refresh = useCallback(() => refreshAccount(), []);
  return { me, user: me?.user ?? null, refresh };
}

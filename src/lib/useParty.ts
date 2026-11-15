import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { PartyState, Progress } from '../shared/types.ts';

export interface StageError {
  entryId: string;
  message: string;
}

/** Live party state over Socket.IO. Re-joins automatically after reconnects. */
export function useParty(code: string) {
  const [state, setState] = useState<PartyState | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [connected, setConnected] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [stageError, setStageError] = useState<StageError | null>(null);
  const [catalogVersion, setCatalogVersion] = useState(0);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io({ transports: ['websocket', 'polling'] });
    socketRef.current = socket;
    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join', code, (res: { ok: boolean; state?: PartyState }) => {
        if (res?.ok && res.state) {
          setState(res.state);
          setNotFound(false);
        } else setNotFound(true);
      });
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('state', (s: PartyState) => setState(s));
    socket.on('progress', (p: Progress) => setProgress(p));
    socket.on('stage:error', (e: StageError) => setStageError(e));
    socket.on('catalog-changed', () => setCatalogVersion((v) => v + 1));
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [code]);

  return { state, setState, notFound, connected, progress, stageError, catalogVersion, socketRef };
}

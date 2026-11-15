import { useEffect, useRef } from 'react';
import type { Song } from '../../shared/types.ts';

export interface PlayerProps {
  song: Song;
  playing: boolean;
  /** Changes whenever the host presses Restart. */
  restartSeq: number;
  onProgress: (time: number, duration: number) => void;
  onEnded: () => void;
  onError: (message: string) => void;
}

/** Keep a ref pointed at the latest value, for use inside long-lived callbacks. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/** Run fn whenever restartSeq changes after mount (and the player is ready). */
export function useRestart(restartSeq: number, ready: boolean, fn: () => void) {
  const applied = useRef(restartSeq);
  const fnRef = useLatest(fn);
  useEffect(() => {
    if (!ready || applied.current === restartSeq) return;
    applied.current = restartSeq;
    fnRef.current();
  }, [restartSeq, ready, fnRef]);
}

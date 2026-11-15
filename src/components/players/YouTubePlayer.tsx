import { useEffect, useRef, useState } from 'react';
import { useLatest, useRestart, type PlayerProps } from './types.ts';
import { loadYouTubeApi, type YTPlayer } from '../../lib/youtube.ts';

const YT_ERRORS: Record<number, string> = {
  2: 'invalid YouTube video',
  5: "this video can't play in a browser",
  100: 'the video was removed or made private',
  101: "the owner blocks playback outside YouTube",
  150: "the owner blocks playback outside YouTube",
};

export function YouTubePlayer({ song, playing, restartSeq, onProgress, onEnded, onError }: PlayerProps) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const cb = useLatest({ onProgress, onEnded, onError, playing });
  const videoId = song.source.kind === 'youtube' ? song.source.videoId : '';

  useEffect(() => {
    let cancelled = false;
    const mount = document.createElement('div');
    host.current!.appendChild(mount);
    loadYouTubeApi().then((YT) => {
      if (cancelled) return;
      player.current = new YT.Player(mount, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, rel: 0, playsinline: 1, iv_load_policy: 3, fs: 0 },
        events: {
          onReady: () => !cancelled && setReady(true),
          onStateChange: (e: { data: number }) => {
            if (e.data === YT.PlayerState.ENDED) cb.current.onEnded();
          },
          onError: (e: { data: number }) => cb.current.onError(YT_ERRORS[e.data] ?? `YouTube error ${e.data}`),
        },
      });
    });
    const hostEl = host.current;
    return () => {
      cancelled = true;
      try {
        player.current?.destroy();
      } catch {
        /* ignore */
      }
      player.current = null;
      setReady(false);
      if (hostEl) hostEl.innerHTML = '';
    };
  }, [videoId, cb]);

  useEffect(() => {
    if (!ready || !player.current) return;
    if (playing) player.current.playVideo();
    else player.current.pauseVideo();
  }, [ready, playing]);

  useRestart(restartSeq, ready, () => {
    player.current?.seekTo(0, true);
    if (cb.current.playing) player.current?.playVideo();
  });

  useEffect(() => {
    if (!ready) return;
    const t = setInterval(() => {
      const p = player.current;
      if (p?.getCurrentTime) cb.current.onProgress(p.getCurrentTime() || 0, p.getDuration() || 0);
    }, 1000);
    return () => clearInterval(t);
  }, [ready, cb]);

  return <div className="player-frame" ref={host} />;
}

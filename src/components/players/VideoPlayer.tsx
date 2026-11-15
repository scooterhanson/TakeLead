import { useEffect, useRef } from 'react';
import { useLatest, useRestart, type PlayerProps } from './types.ts';

export function VideoPlayer({ song, playing, restartSeq, onProgress, onEnded, onError }: PlayerProps) {
  const video = useRef<HTMLVideoElement>(null);
  const cb = useLatest({ onError, playing });
  const url = song.source.kind === 'video' ? song.source.url : '';

  useEffect(() => {
    const el = video.current!;
    if (playing) el.play().catch((e: Error) => e.name !== 'AbortError' && cb.current.onError('the browser blocked playback'));
    else el.pause();
  }, [playing, url, cb]);

  useRestart(restartSeq, true, () => {
    const el = video.current!;
    el.currentTime = 0;
    if (cb.current.playing) el.play().catch(() => {});
  });

  return (
    <video
      ref={video}
      className="player-frame"
      src={url}
      playsInline
      preload="auto"
      onEnded={onEnded}
      onTimeUpdate={(e) => onProgress(e.currentTarget.currentTime, e.currentTarget.duration || 0)}
      onError={() => onError("couldn't load the video file")}
    />
  );
}

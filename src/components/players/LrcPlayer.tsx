import { useEffect, useRef, useState } from 'react';
import { parseLrc, type Lrc } from '../../lib/lrc.ts';
import { Lyrics } from './Lyrics.tsx';
import { useLatest, useRestart, type PlayerProps } from './types.ts';

export function LrcPlayer({ song, playing, restartSeq, onProgress, onEnded, onError }: PlayerProps) {
  const audio = useRef<HTMLAudioElement>(null);
  const [lrc, setLrc] = useState<Lrc | null>(null);
  const [time, setTime] = useState(0);
  const cb = useLatest({ onError, playing });
  const src = song.source.kind === 'lrc' ? song.source : null;

  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    fetch(src.lrcUrl)
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.text();
      })
      .then((t) => !cancelled && setLrc(parseLrc(t)))
      .catch(() => !cancelled && cb.current.onError("couldn't load the lyrics file"));
    return () => {
      cancelled = true;
    };
  }, [src?.lrcUrl, cb]);

  useEffect(() => {
    const el = audio.current!;
    if (playing) el.play().catch((e: Error) => e.name !== 'AbortError' && cb.current.onError('the browser blocked playback'));
    else el.pause();
  }, [playing, cb]);

  useRestart(restartSeq, true, () => {
    const el = audio.current!;
    el.currentTime = 0;
    setTime(0);
    if (cb.current.playing) el.play().catch(() => {});
  });

  // Smooth lyric timing while playing.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      setTime(audio.current?.currentTime ?? 0);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  if (!src) return null;
  return (
    <div className="player-frame lrc-stage">
      <audio
        ref={audio}
        src={src.audioUrl}
        preload="auto"
        onEnded={onEnded}
        onTimeUpdate={(e) => onProgress(e.currentTarget.currentTime, e.currentTarget.duration || 0)}
        onError={() => onError("couldn't load the audio file")}
      />
      {lrc ? <Lyrics lrc={lrc} time={time} title={song.title} artist={song.artist} /> : null}
    </div>
  );
}

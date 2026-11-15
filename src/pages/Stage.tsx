import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useParty } from '../lib/useParty.ts';
import { useJoinUrl } from '../lib/joinUrl.ts';
import { QR } from '../components/QR.tsx';
import { Logo } from '../components/common.tsx';
import { SongPlayer } from '../components/players/SongPlayer.tsx';
import { Centered } from './Guest.tsx';
import { Avatar } from '../components/Avatar.tsx';
import { useTheme } from '../lib/theme.ts';

/** The "Now Playing" screen, meant to be cast or mirrored to a TV. */
export function Stage() {
  const code = useParams().code!.toUpperCase();
  const [params] = useSearchParams();
  const stageKey = params.get('k') ?? '';
  const { state, notFound, socketRef } = useParty(code);
  const joinUrl = useJoinUrl(code);
  // ?autostart=1 skips the click-to-start overlay (for kiosk/TV browsers that allow autoplay).
  const [unlocked, setUnlocked] = useState(params.get('autostart') === '1');
  const [error, setError] = useState<{ entryId: string; message: string } | null>(null);
  useTheme(state?.theme);

  // Detect Restart commands (one-shot) from seq bumps.
  const lastSeq = useRef<number | null>(null);
  const [restartSeq, setRestartSeq] = useState(0);
  useEffect(() => {
    if (!state) return;
    if (lastSeq.current !== null && state.seq !== lastSeq.current && state.command === 'restart') {
      setRestartSeq((n) => n + 1);
      setError(null);
    }
    lastSeq.current = state.seq;
  }, [state]);

  const currentId = state?.current?.id ?? null;
  const emit = useCallback(
    (event: string, payload: Record<string, unknown>) => socketRef.current?.emit(event, { code, k: stageKey, ...payload }),
    [code, stageKey, socketRef],
  );

  const lastProgress = useRef(0);
  const onProgress = useCallback(
    (time: number, duration: number) => {
      const now = Date.now();
      if (!currentId || now - lastProgress.current < 1000) return;
      lastProgress.current = now;
      emit('stage:progress', { entryId: currentId, time, duration });
    },
    [currentId, emit],
  );
  const onEnded = useCallback(() => currentId && emit('stage:ended', { entryId: currentId }), [currentId, emit]);
  const onError = useCallback(
    (message: string) => {
      if (!currentId) return;
      setError({ entryId: currentId, message });
      emit('stage:error', { entryId: currentId, message });
    },
    [currentId, emit],
  );

  // Hide the cursor when idle on the big screen.
  const [cursorHidden, setCursorHidden] = useState(false);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const wake = () => {
      setCursorHidden(false);
      clearTimeout(t);
      t = setTimeout(() => setCursorHidden(true), 3000);
    };
    wake();
    window.addEventListener('mousemove', wake);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousemove', wake);
    };
  }, []);

  if (notFound) return <Centered title="Party not found" body={`No party with code ${code}.`} />;
  if (!state) return <div className="stage" />;

  const { current, queue, status } = state;
  const upNext = queue[0];
  const showIntro = current && status === 'ready';
  const currentError = error && error.entryId === current?.id ? error : null;

  return (
    <div className={`stage ${cursorHidden ? 'no-cursor' : ''}`}>
      {current ? (
        <SongPlayer
          key={current.id}
          song={current.song}
          playing={unlocked && status === 'playing'}
          restartSeq={restartSeq}
          onProgress={onProgress}
          onEnded={onEnded}
          onError={onError}
        />
      ) : (
        <div className="stage-idle">
          <Logo />
          <h1>{state.name}</h1>
          <QR value={joinUrl} size={300} />
          <p className="stage-cta">Scan to pick a song</p>
          <p className="muted mono">
            {joinUrl.replace(/^https?:\/\//, '')} · code <strong>{state.code}</strong>
          </p>
        </div>
      )}

      {showIntro && (
        <div className="stage-intro">
          <span className="eyebrow">{state.songsSung === 0 ? 'First up' : 'Up next'}</span>
          {current.avatarUrl && <Avatar name={current.singer} url={current.avatarUrl} size={220} className="intro-avatar" />}
          <div className="intro-singer">{current.singer}</div>
          {current.blurb && <div className="intro-blurb">“{current.blurb}”</div>}
          <div className="intro-song">
            {current.song.title} <span className="muted">· {current.song.artist}</span>
          </div>
        </div>
      )}

      {current && !showIntro && (
        <div className="stage-topbar">
          <span className="topbar-singer">
            <Avatar name={current.singer} url={current.avatarUrl} size={36} />
            <strong>{current.singer}</strong>
            <span className="muted"> · {current.song.title}</span>
          </span>
          {upNext && (
            <span className="muted">
              Next: <strong>{upNext.singer}</strong>
            </span>
          )}
        </div>
      )}

      {current && (
        <div className="stage-qr">
          <QR value={joinUrl} size={showIntro ? 160 : 96} />
          <span>
            Scan to sing
            <br />
            <strong className="mono">{state.code}</strong>
          </span>
        </div>
      )}

      {(showIntro || !current) && queue.length > 0 && (
        <div className="stage-lineup">
          <span className="eyebrow">Coming up</span>
          {queue.slice(0, 5).map((e, i) => (
            <div key={e.id} className="lineup-row">
              <span className="lineup-n">{i + 1}</span>
              <Avatar name={e.singer} url={e.avatarUrl} size={32} />
              <strong>{e.singer}</strong>
              <span className="muted">{e.song.title}</span>
            </div>
          ))}
          {queue.length > 5 && <div className="muted small">+{queue.length - 5} more</div>}
        </div>
      )}

      {status === 'paused' && current && <div className="stage-paused">❚❚ Paused</div>}

      {currentError && (
        <div className="stage-error">
          <strong>Can't play this one</strong>
          <span>{currentError.message}</span>
          <span className="muted">The host can skip to the next singer.</span>
        </div>
      )}

      {!unlocked && (
        <div className="stage-unlock">
          <Logo />
          <button
            className="btn btn-primary btn-xl"
            onClick={() => {
              setUnlocked(true);
              document.documentElement.requestFullscreen?.().catch(() => {});
            }}
          >
            Start the show
          </button>
          <p className="muted">
            Click once to allow sound, then show this window on the TV.
            {!stageKey && <><br />To have songs advance on their own, open this screen from the host dashboard.</>}
          </p>
        </div>
      )}
    </div>
  );
}

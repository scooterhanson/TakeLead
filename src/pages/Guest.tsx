import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { api } from '../lib/api.ts';
import { storage } from '../lib/storage.ts';
import { useParty } from '../lib/useParty.ts';
import { useTheme } from '../lib/theme.ts';
import { prepareAvatar } from '../lib/image.ts';
import { GenreTag, Logo, SortControl, SourceBadge, groupSongs, matchesSearch, type SongSort } from '../components/common.tsx';
import { Avatar } from '../components/Avatar.tsx';
import { HelpButton } from '../components/Help.tsx';
import type { GuestProfile, QueueEntry, Song } from '../shared/types.ts';

const MAX_BLURB = 140;

export function Guest() {
  const code = useParams().code!.toUpperCase();
  const { state, notFound, connected, catalogVersion } = useParty(code);
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [tab, setTab] = useState<'songs' | 'queue'>('songs');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SongSort>(() => storage.songSort());
  const [picked, setPicked] = useState<Song | null>(null);
  const [mine, setMine] = useState(() => storage.myEntries(code));
  const [toast, setToast] = useState('');
  const [profile, setProfile] = useState<GuestProfile>({ name: storage.singerName(), blurb: '', avatarUrl: null });
  const [editingProfile, setEditingProfile] = useState(false);
  useTheme(state?.theme);

  useEffect(() => {
    api.profile(storage.guestId()).then(
      (p) => setProfile((cur) => ({ ...p, name: p.name || cur.name })),
      () => {},
    );
  }, []);

  const songsKey = state ? `${state.mode}|${state.playlistSongIds.join(',')}` : '';
  useEffect(() => {
    if (!songsKey) return;
    api.songs(code).then(setSongs).catch(() => setSongs([]));
  }, [code, songsKey, catalogVersion]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const filtered = useMemo(() => (songs ?? []).filter((s) => matchesSearch(s, q)), [songs, q]);
  const groups = useMemo(() => groupSongs(filtered, sort), [filtered, sort]);

  if (notFound) return <Centered title="Party not found" body={`No party uses the code ${code}. Check the code and try again.`} />;
  if (!state) return <Centered title="Joining…" body="" />;

  const lineup: QueueEntry[] = [...(state.current ? [state.current] : []), ...state.queue];
  const myNext = lineup.findIndex((e) => mine.includes(e.id));
  // Songs already queued or playing can't be picked again.
  const queuedSongs = new Map(lineup.map((e) => [e.song.id, e]));

  async function cancel(entry: QueueEntry) {
    if (!confirm(`Remove "${entry.song.title}" from the queue?`)) return;
    try {
      await api.cancel(code, entry.id, storage.guestId());
    } catch (err) {
      setToast((err as Error).message);
    }
  }

  return (
    <div className="page guest">
      <header className="guest-header">
        <Logo small />
        <div className="guest-party">
          <strong>{state.name}</strong>
          <span className="muted mono">{state.code}</span>
          {!connected && <span className="dot dot-off" title="Reconnecting" />}
        </div>
        <HelpButton audience="guest" label="?" />
        <button className="me-btn" onClick={() => setEditingProfile(true)} aria-label="Edit my profile">
          <Avatar name={profile.name} url={profile.avatarUrl} size={36} />
        </button>
      </header>

      {state.current && (
        <div className="now-strip">
          <Avatar name={state.current.singer} url={state.current.avatarUrl} size={48} />
          <span className="stack tight grow">
            <span className="eyebrow">{state.status === 'playing' ? 'Now singing' : 'Up now'}</span>
            <strong>{state.current.singer}</strong>
            <span className="muted">
              {state.current.song.title} · {state.current.song.artist}
            </span>
          </span>
        </div>
      )}

      {myNext >= 0 && (
        <div className="my-turn">
          {myNext === 0 ? "You're up." : myNext === 1 ? "You're next." : `${myNext} singers ahead of you.`}
        </div>
      )}

      {!profile.name && (
        <button className="banner banner-btn" onClick={() => setEditingProfile(true)}>
          Add your name and a photo. They show on the TV when it's your turn.
        </button>
      )}

      {!state.signupsOpen && <div className="banner">The host has paused sign-ups.</div>}

      <nav className="tabs">
        <button className={tab === 'songs' ? 'active' : ''} onClick={() => setTab('songs')}>
          Songs
        </button>
        <button className={tab === 'queue' ? 'active' : ''} onClick={() => setTab('queue')}>
          Queue <span className="count">{lineup.length}</span>
        </button>
      </nav>

      {tab === 'songs' ? (
        <section>
          <input
            className="search"
            type="search"
            placeholder="Search songs, artists or genres"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <SortControl
            value={sort}
            onChange={(v) => {
              setSort(v);
              storage.setSongSort(v);
            }}
          />
          {songs === null ? (
            <p className="muted center">Loading songs…</p>
          ) : filtered.length === 0 ? (
            <p className="muted center">{songs.length === 0 ? 'The host hasn’t added any songs yet.' : 'No matches.'}</p>
          ) : (
            <>
              {groups.length > 3 && (
                <nav className="jump-bar" aria-label="Jump to section">
                  {groups.map((g) => (
                    <a key={g.label} href={`#sec-${encodeURIComponent(g.label)}`}>
                      {g.label}
                    </a>
                  ))}
                </nav>
              )}
              {groups.map((g) => (
                <div key={g.label} className="song-section" id={`sec-${encodeURIComponent(g.label)}`}>
                  <h3 className="section-label">
                    {g.label} <span className="count">{g.songs.length}</span>
                  </h3>
                  <ul className="song-list">
                    {g.songs.map((s) => {
                      const taken = queuedSongs.get(s.id);
                      return (
                        <li key={s.id}>
                          <button
                            className={`song-row ${taken ? 'taken' : ''}`}
                            onClick={() => setPicked(s)}
                            disabled={!state.signupsOpen || !!taken}
                          >
                            <span className="song-text">
                              <strong>{sort === 'artist' ? s.artist : s.title}</strong>
                              <span className="muted">
                                {sort === 'artist' ? s.title : s.artist}
                                {sort !== 'genre' && <GenreTag song={s} />}
                              </span>
                            </span>
                            {taken ? (
                              <span className="song-taken">{mine.includes(taken.id) ? 'Yours' : 'In queue'}</span>
                            ) : (
                              <span className="song-cta">Sing</span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </>
          )}
        </section>
      ) : (
        <section>
          {lineup.length === 0 ? (
            <p className="muted center">No one has signed up yet.</p>
          ) : (
            <ol className="queue-list">
              {lineup.map((e, i) => {
                const isMine = mine.includes(e.id);
                const isCurrent = i === 0 && !!state.current;
                return (
                  <li key={e.id} className={`queue-row ${isMine ? 'mine' : ''} ${isCurrent ? 'is-current' : ''}`}>
                    <span className="queue-pos">{isCurrent ? '🎤' : i + (state.current ? 0 : 1)}</span>
                    <Avatar name={e.singer} url={e.avatarUrl} size={40} />
                    <span className="song-text">
                      <strong>
                        {e.singer} {isMine && <span className="badge">You</span>}
                      </strong>
                      <span className="muted">
                        {e.song.title} · {e.song.artist}
                      </span>
                      {e.blurb && <span className="blurb">“{e.blurb}”</span>}
                    </span>
                    {isMine && !isCurrent && (
                      <button className="icon-btn" onClick={() => cancel(e)} aria-label="Remove my sign-up">
                        ✕
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      )}

      {picked && (
        <SignUpSheet
          song={picked}
          defaultName={profile.name}
          onClose={() => setPicked(null)}
          onSubmit={async (singer) => {
            const { id } = await api.signUp(code, picked.id, singer, storage.guestId());
            storage.setSingerName(singer);
            storage.addMyEntry(code, id);
            setMine(storage.myEntries(code));
            setProfile((p) => ({ ...p, name: singer }));
            setPicked(null);
            setTab('queue');
            setToast(`Added to the queue: ${picked.title}`);
          }}
        />
      )}

      {editingProfile && (
        <ProfileSheet
          profile={profile}
          onClose={() => setEditingProfile(false)}
          onChange={(p) => {
            setProfile(p);
            if (p.name) storage.setSingerName(p.name);
          }}
          onSaved={() => {
            setEditingProfile(false);
            setToast('Profile saved');
          }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function SignUpSheet({
  song,
  defaultName,
  onClose,
  onSubmit,
}: {
  song: Song;
  defaultName: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Enter your name.');
    setBusy(true);
    setError('');
    try {
      await onSubmit(name.trim());
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="sheet-song">
          <span className="eyebrow">Sign up to sing</span>
          <h2>{song.title}</h2>
          <p className="muted">
            {song.artist} <SourceBadge song={song} />
          </p>
        </div>
        <label className="field">
          <span>Your name, as it will appear on the TV</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. Jess" />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary grow" disabled={busy}>
            {busy ? 'Adding…' : 'Add me to the queue'}
          </button>
        </div>
      </form>
    </div>
  );
}

function ProfileSheet({
  profile,
  onClose,
  onChange,
  onSaved,
}: {
  profile: GuestProfile;
  onClose: () => void;
  onChange: (p: GuestProfile) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(profile.name);
  const [blurb, setBlurb] = useState(profile.blurb);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const guestId = storage.guestId();

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    setError('');
    setBusy('Uploading photo…');
    try {
      onChange(await api.uploadAvatar(guestId, await prepareAvatar(file)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Enter your name.');
    setBusy('Saving…');
    setError('');
    try {
      onChange(await api.saveProfile(guestId, { name: name.trim(), blurb }));
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <span className="eyebrow">Your profile</span>
        <div className="profile-photo">
          <button type="button" className="avatar-edit" onClick={() => fileInput.current?.click()} aria-label="Change photo">
            <Avatar name={name} url={profile.avatarUrl} size={96} />
            <span className="avatar-edit-badge">📷</span>
          </button>
          <div className="stack tight">
            <button type="button" className="btn btn-sm" onClick={() => fileInput.current?.click()} disabled={!!busy}>
              {profile.avatarUrl ? 'Change photo' : 'Add a photo'}
            </button>
            {profile.avatarUrl && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                disabled={!!busy}
                onClick={async () => onChange(await api.removeAvatar(guestId))}
              >
                Remove photo
              </button>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => pickPhoto(e.target.files?.[0])}
          />
        </div>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. Jess" />
        </label>
        <label className="field">
          <span>
            About you <span className="muted">(shown on the TV during your turn)</span>
          </span>
          <textarea
            value={blurb}
            onChange={(e) => setBlurb(e.target.value.slice(0, MAX_BLURB))}
            rows={2}
            maxLength={MAX_BLURB}
            placeholder="One line, e.g. First time singing in public"
          />
          <span className="muted small right">
            {blurb.length}/{MAX_BLURB}
          </span>
        </label>
        <p className="muted small">Everyone at the party can see your photo and this line. The host can remove them.</p>
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
          <button className="btn btn-primary grow" disabled={!!busy}>
            {busy || 'Save profile'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function Centered({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="page centered">
      <Logo />
      <h2>{title}</h2>
      {body && <p className="muted">{body}</p>}
      {children}
      <a className="btn" href="/">
        Home
      </a>
    </div>
  );
}

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { api, hostApi, type HostApi } from '../lib/api.ts';
import { storage, type HostedParty } from '../lib/storage.ts';
import { useParty } from '../lib/useParty.ts';
import { useBaseUrl } from '../lib/joinUrl.ts';
import { copyText } from '../lib/clipboard.ts';
import { fetchPlaylistVideoIds, hasVideoId, playlistIdFromUrl } from '../lib/youtube.ts';
import { QR } from '../components/QR.tsx';
import {
  GenreTag,
  Logo,
  SortControl,
  SourceBadge,
  formatTime,
  groupSongs,
  matchesSearch,
  type SongSort,
} from '../components/common.tsx';
import { Centered } from './Guest.tsx';
import { Avatar } from '../components/Avatar.tsx';
import { AccountModal } from '../components/AccountModal.tsx';
import { ThemePicker } from '../components/ThemePicker.tsx';
import { HelpButton } from '../components/Help.tsx';
import { useAccount } from '../lib/account.ts';
import { useTheme } from '../lib/theme.ts';
import type { PartyState, Progress, QueueEntry, SavedPlaylist, Song } from '../shared/types.ts';

export function Host() {
  const code = useParams().code!.toUpperCase();
  const [auth, setAuth] = useState<HostedParty | null>(() => storage.hostedParty(code));
  const [authOk, setAuthOk] = useState<boolean | null>(null);
  const party = useParty(code);
  const { state, setState, notFound, connected } = party;
  const [toast, setToast] = useState('');
  const [showAccount, setShowAccount] = useState(false);
  const { me, user, refresh: refreshMe } = useAccount();
  const ownsParty = !!me?.parties.some((p) => p.code === code);
  useEffect(() => {
    refreshMe(); // pick up parties created or claimed since the account info was last loaded
  }, [code, refreshMe]);
  useTheme(state?.theme);

  // A "host link" (#host=…&stage=…) lets the host move to another device.
  useEffect(() => {
    const h = new URLSearchParams(window.location.hash.slice(1));
    const hostToken = h.get('host');
    const stageToken = h.get('stage');
    if (hostToken && stageToken) {
      const p = { code, name: '', hostToken, stageToken, createdAt: Date.now() };
      storage.saveHostedParty(p);
      setAuth(p);
      history.replaceState(null, '', window.location.pathname);
    }
  }, [code]);

  const host = useMemo(() => (auth ? hostApi(code, auth.hostToken) : null), [auth, code]);

  useEffect(() => {
    if (!host) return setAuthOk(false);
    host.check().then(
      () => setAuthOk(true),
      () => setAuthOk(false),
    );
  }, [host]);

  // Signed in as the party's owner on a device without its host key: fetch the keys from the account.
  useEffect(() => {
    if (!ownsParty || (auth && authOk !== false)) return;
    api.partyCredentials(code).then(
      (c) => {
        const p = { code, name: state?.name ?? '', ...c, createdAt: Date.now() };
        storage.saveHostedParty(p);
        setAuth(p);
      },
      () => {},
    );
  }, [ownsParty, auth, authOk, code]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the saved party name fresh for the home screen list.
  useEffect(() => {
    if (auth && state && auth.name !== state.name) {
      const updated = { ...auth, name: state.name };
      storage.saveHostedParty(updated);
      setAuth(updated);
    }
  }, [state?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  if (notFound) return <Centered title="Party not found" body={`No party with code ${code}.`} />;
  if (authOk === false || !auth || !host)
    return (
      <>
        <Centered
          title="Host access needed"
          body={
            user
              ? `This party isn't in your account. Open the host link from the device that created it.`
              : 'Sign in if this party is saved to your account, or open the host link from the device that created it.'
          }
        >
          {!user && (
            <button className="btn btn-primary" onClick={() => setShowAccount(true)}>
              Host sign in
            </button>
          )}
        </Centered>
        {showAccount && <AccountModal onClose={() => setShowAccount(false)} />}
      </>
    );
  if (!state || authOk === null) return <Centered title="Loading…" body="" />;

  const run = async (fn: () => Promise<unknown>) => {
    try {
      const result = await fn();
      if (result && typeof result === 'object' && 'code' in result) setState(result as PartyState);
    } catch (err) {
      setToast((err as Error).message);
    }
  };

  return (
    <div className="page host">
      <header className="host-header">
        <Link to="/" className="plain">
          <Logo small />
        </Link>
        <PartyName state={state} onRename={(name) => run(() => host.update({ name }))} />
        <span className="code-pill mono" title="Party code">
          {state.code}
        </span>
        <span className={`dot ${connected ? 'dot-on' : 'dot-off'}`} title={connected ? 'Live' : 'Reconnecting…'} />
        <HelpButton audience="host" />
        <span className="account-chip">
          {user && ownsParty ? (
            <span className="muted small" title={`Saved to ${user.email}`}>
              ☁︎ Saved to your account
            </span>
          ) : user ? (
            <button
              className="btn btn-sm"
              onClick={() =>
                run(async () => {
                  await host.claim();
                  await refreshMe();
                  setToast('Party saved to your account');
                })
              }
            >
              Save to my account
            </button>
          ) : (
            <button className="btn btn-sm btn-ghost" onClick={() => setShowAccount(true)}>
              Sign in to save
            </button>
          )}
        </span>
      </header>

      <div className="host-grid">
        <div className="stack">
          <NowPlaying state={state} progress={party.progress} stageError={party.stageError} run={run} host={host} />
          <QueueManager state={state} run={run} host={host} code={code} />
        </div>
        <div className="stack">
          <ShareCard state={state} auth={auth} setToast={setToast} />
          <section className="card">
            <h2>Theme</h2>
            <p className="muted small">Applies to the Now Playing screen and every guest's phone.</p>
            <ThemePicker value={state.theme} onChange={(theme) => run(() => host.update({ theme }))} />
          </section>
          <Library
            state={state}
            run={run}
            host={host}
            catalogVersion={party.catalogVersion}
            setToast={setToast}
            playlists={user ? (me?.playlists ?? []) : null}
            onPlaylistsChanged={refreshMe}
            onSignIn={() => setShowAccount(true)}
          />
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
      {showAccount && <AccountModal onClose={() => setShowAccount(false)} />}
    </div>
  );
}

type Run = (fn: () => Promise<unknown>) => Promise<void>;

function PartyName({ state, onRename }: { state: PartyState; onRename: (n: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(state.name);
  if (!editing)
    return (
      <h1 className="party-name" onClick={() => (setValue(state.name), setEditing(true))} title="Click to rename">
        {state.name}
      </h1>
    );
  return (
    <form
      className="party-name-form"
      onSubmit={(e) => {
        e.preventDefault();
        onRename(value);
        setEditing(false);
      }}
    >
      <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => setEditing(false)} maxLength={60} />
    </form>
  );
}

/* ----------------------------------------------------------- now playing */

function NowPlaying({
  state,
  progress,
  stageError,
  run,
  host,
}: {
  state: PartyState;
  progress: Progress | null;
  stageError: { entryId: string; message: string } | null;
  run: Run;
  host: HostApi;
}) {
  const { current, status } = state;
  const prog = current && progress?.entryId === current.id ? progress : null;
  const err = current && stageError?.entryId === current.id ? stageError : null;

  return (
    <section className="card now-card">
      <div className="row spread">
        <h2>Now playing</h2>
        <span className={`status status-${status}`}>{status}</span>
      </div>
      {current ? (
        <>
          <div className="row">
            <Avatar name={current.singer} url={current.avatarUrl} size={56} />
            <div className="stack tight grow">
              <div className="now-singer">{current.singer}</div>
              {current.blurb && (
                <span className="blurb">
                  “{current.blurb}”{' '}
                  <button className="link-btn small" onClick={() => run(() => host.hideProfile(current.id))}>
                    hide
                  </button>
                </span>
              )}
            </div>
          </div>
          <div className="now-song">
            {current.song.title} <span className="muted">· {current.song.artist}</span> <SourceBadge song={current.song} />
          </div>
          <div className="progress">
            <div className="progress-bar" style={{ width: prog?.duration ? `${(prog.time / prog.duration) * 100}%` : '0%' }} />
          </div>
          <div className="row spread small muted">
            <span>{formatTime(prog?.time ?? 0)}</span>
            <span>{prog?.duration ? formatTime(prog.duration) : '--:--'}</span>
          </div>
          {status === 'ready' && <p className="hint">{current.singer}'s name is on the TV. Press Play when they're ready.</p>}
          {err && (
            <p className="error">
              The TV can't play this song ({err.message}). Skip to the next singer.
            </p>
          )}
        </>
      ) : (
        <p className="muted">{state.queue.length ? 'Ready to start.' : 'Waiting for sign-ups.'}</p>
      )}
      <div className="controls">
        <button
          className="btn btn-primary btn-lg"
          disabled={!current && state.queue.length === 0}
          onClick={() => run(() => host.control('toggle'))}
        >
          {status === 'playing' ? '❚❚ Pause' : '▶ Play'}
        </button>
        <button className="btn btn-lg" disabled={!current} onClick={() => run(() => host.control('restart'))}>
          ⟲ Restart
        </button>
        <button
          className="btn btn-lg"
          disabled={!current}
          onClick={() => {
            if (status !== 'playing' || confirm(`Stop ${current?.singer}'s song and go to the next singer?`))
              run(() => host.control('next'));
          }}
        >
          ⏭ Next singer
        </button>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- queue */

function QueueManager({ state, run, host, code }: { state: PartyState; run: Run; host: HostApi; code: string }) {
  const [order, setOrder] = useState<QueueEntry[]>(state.queue);
  const [dragId, setDragId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => setOrder(state.queue), [state.queue]);

  const commit = (next: QueueEntry[]) => {
    setOrder(next);
    run(() => host.reorder(next.map((e) => e.id)));
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    const next = [...order];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    commit(next);
  };

  return (
    <section className="card">
      <div className="row spread">
        <h2>
          Queue <span className="count">{order.length}</span>
        </h2>
        <div className="row">
          <label className="toggle">
            <input
              type="checkbox"
              checked={state.signupsOpen}
              onChange={(e) => run(() => host.update({ signupsOpen: e.target.checked }))}
            />
            <span>Sign-ups open</span>
          </label>
          <button className="btn btn-sm" onClick={() => setAdding((a) => !a)}>
            + Add singer
          </button>
        </div>
      </div>

      {adding && <AddSinger code={code} host={host} run={run} onDone={() => setAdding(false)} />}

      {order.length === 0 ? (
        <p className="muted">The queue is empty. Share the QR code to get sign-ups.</p>
      ) : (
        <ol className="queue-list host-queue">
          {order.map((e, i) => (
            <li
              key={e.id}
              className={`queue-row ${dragId === e.id ? 'dragging' : ''}`}
              draggable
              onDragStart={(ev) => {
                setDragId(e.id);
                ev.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => setDragId(null)}
              onDragOver={(ev) => ev.preventDefault()}
              onDrop={(ev) => {
                ev.preventDefault();
                const from = order.findIndex((x) => x.id === dragId);
                if (from >= 0) move(from, i);
                setDragId(null);
              }}
            >
              <span className="drag-handle" aria-hidden>
                ⋮⋮
              </span>
              <span className="queue-pos">{i + 1}</span>
              <Avatar name={e.singer} url={e.avatarUrl} size={36} />
              <span className="song-text">
                <strong>{e.singer}</strong>
                <span className="muted">
                  {e.song.title} · {e.song.artist}
                </span>
                {e.blurb && <span className="blurb">“{e.blurb}”</span>}
              </span>
              <span className="row tight">
                {(e.avatarUrl || e.blurb) && (
                  <button
                    className="icon-btn"
                    title="Remove this guest's photo and blurb"
                    onClick={() =>
                      confirm(`Remove ${e.singer}'s photo and blurb?`) &&
                      run(() => host.hideProfile(e.id))
                    }
                  >
                    🙈
                  </button>
                )}
                <button className="icon-btn" title="Move to top" disabled={i === 0} onClick={() => move(i, 0)}>
                  ⤒
                </button>
                <button className="icon-btn" title="Move up" disabled={i === 0} onClick={() => move(i, i - 1)}>
                  ↑
                </button>
                <button className="icon-btn" title="Move down" disabled={i === order.length - 1} onClick={() => move(i, i + 1)}>
                  ↓
                </button>
                <button
                  className="icon-btn danger"
                  title="Remove"
                  onClick={() => confirm(`Remove ${e.singer} – "${e.song.title}"?`) && run(() => host.remove(e.id))}
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function AddSinger({ code, host, run, onDone }: { code: string; host: HostApi; run: Run; onDone: () => void }) {
  const [songs, setSongs] = useState<Song[]>([]);
  const [name, setName] = useState('');
  const [q, setQ] = useState('');
  const [songId, setSongId] = useState<string | null>(null);
  useEffect(() => {
    api.songs(code).then(setSongs, () => {});
  }, [code]);
  const matches = songs.filter((s) => matchesSearch(s, q)).slice(0, 8);

  return (
    <form
      className="add-singer"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (!name.trim() || !songId) return;
        run(() => host.addSinger(songId, name)).then(onDone);
      }}
    >
      <input placeholder="Singer name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus />
      <input type="search" placeholder="Search songs" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="pick-list">
        {matches.map((s) => (
          <li key={s.id}>
            <button type="button" className={songId === s.id ? 'picked' : ''} onClick={() => setSongId(s.id)}>
              <strong>{s.title}</strong> <span className="muted">· {s.artist}</span>
            </button>
          </li>
        ))}
      </ul>
      <button className="btn btn-primary" disabled={!name.trim() || !songId}>
        Add to queue
      </button>
    </form>
  );
}

/* ----------------------------------------------------------------- share */

function ShareCard({ state, auth, setToast }: { state: PartyState; auth: HostedParty; setToast: (s: string) => void }) {
  const base = useBaseUrl();
  const joinUrl = `${base}/p/${state.code}`;
  const stagePath = `/stage/${state.code}?k=${auth.stageToken}`;
  const hostLink = `${base}/host/${state.code}#host=${auth.hostToken}&stage=${auth.stageToken}`;
  const copy = async (text: string, what: string) => setToast((await copyText(text)) ? `${what} copied` : 'Copy failed');

  return (
    <section className="card share-card">
      <h2>Invite guests</h2>
      <div className="share-body">
        <QR value={joinUrl} size={160} />
        <div className="stack tight">
          <code className="url">{joinUrl}</code>
          <button className="btn btn-sm" onClick={() => copy(joinUrl, 'Guest link')}>
            Copy guest link
          </button>
          <a className="btn btn-primary" href={stagePath} target="_blank" rel="noreferrer">
            Open Now Playing screen ↗
          </a>
          <button className="btn btn-sm btn-ghost" onClick={() => copy(base + stagePath, 'Stage link')}>
            Copy stage link (for a TV browser)
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => copy(hostLink, 'Private host link')}>
            Copy host link (keep private)
          </button>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- library */

function Library({
  state,
  run,
  host,
  catalogVersion,
  setToast,
  playlists,
  onPlaylistsChanged,
  onSignIn,
}: {
  state: PartyState;
  run: Run;
  host: HostApi;
  catalogVersion: number;
  setToast: (s: string) => void;
  /** Saved playlists, or null when not signed in. */
  playlists: SavedPlaylist[] | null;
  onPlaylistsChanged: () => void;
  onSignIn: () => void;
}) {
  const [catalog, setCatalog] = useState<Song[] | null>(null);
  const [view, setView] = useState<'playlist' | 'all'>(state.mode === 'curated' ? 'playlist' : 'all');
  const [q, setQ] = useState('');
  const [reload, setReload] = useState(0);
  const [sort, setSort] = useState<SongSort>(() => storage.songSort());
  const [editing, setEditing] = useState<string | null>(null);
  const [pendingLookups, setPendingLookups] = useState(0);
  const inPlaylist = useMemo(() => new Set(state.playlistSongIds), [state.playlistSongIds]);

  useEffect(() => {
    host.catalog().then(setCatalog, (e: Error) => setToast(e.message));
    host.catalogStatus().then((r) => setPendingLookups(r.pendingLookups), () => {});
  }, [host, reload, catalogVersion, setToast]);

  // While genre lookups are running, poll the remaining count (the catalog itself refreshes via socket).
  useEffect(() => {
    if (pendingLookups === 0) return;
    const t = setInterval(() => host.catalogStatus().then((r) => setPendingLookups(r.pendingLookups), () => {}), 5000);
    return () => clearInterval(t);
  }, [host, pendingLookups]);

  const genres = useMemo(
    () => [...new Set((catalog ?? []).map((s) => s.genre).filter((g): g is string => !!g))].sort(),
    [catalog],
  );

  const shown = (catalog ?? []).filter((s) => (view === 'all' || inPlaylist.has(s.id)) && matchesSearch(s, q));
  const notInPlaylist = shown.filter((s) => !inPlaylist.has(s.id));
  const groups = groupSongs(shown, sort);

  return (
    <section className="card">
      <div className="row spread">
        <h2>Song library</h2>
      </div>

      <div className="segmented" role="radiogroup" aria-label="Which songs guests can pick">
        <button
          className={state.mode === 'open' ? 'active' : ''}
          onClick={() => run(() => host.update({ mode: 'open' }))}
          role="radio"
          aria-checked={state.mode === 'open'}
        >
          Guests see whole catalog
        </button>
        <button
          className={state.mode === 'curated' ? 'active' : ''}
          onClick={() => run(() => host.update({ mode: 'curated' }))}
          role="radio"
          aria-checked={state.mode === 'curated'}
        >
          Guests see my playlist only
        </button>
      </div>
      {state.mode === 'curated' && state.playlistSongIds.length === 0 && (
        <p className="hint">Guests can't pick anything until you add songs to the party playlist.</p>
      )}

      <nav className="tabs tabs-sm">
        <button className={view === 'playlist' ? 'active' : ''} onClick={() => setView('playlist')}>
          Party playlist <span className="count">{state.playlistSongIds.length}</span>
        </button>
        <button className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}>
          Full catalog <span className="count">{catalog?.length ?? 0}</span>
        </button>
      </nav>

      <div className="row">
        <input className="search grow" type="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        {view === 'all' && notInPlaylist.length > 0 && (
          <button className="btn btn-sm" onClick={() => run(() => host.addToPlaylist(notInPlaylist.map((s) => s.id)))}>
            Add {notInPlaylist.length} shown
          </button>
        )}
      </div>

      <div className="row spread">
        <SortControl
          value={sort}
          onChange={(v) => {
            setSort(v);
            storage.setSongSort(v);
          }}
        />
        {pendingLookups > 0 && (
          <span className="muted small" title="Genres and artist names are looked up from the iTunes catalog">
            <span className="spinner" /> Looking up genres… {pendingLookups} left
          </span>
        )}
      </div>

      {catalog === null ? (
        <p className="muted">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="muted">{view === 'playlist' ? 'No songs in the playlist yet. Switch to Full catalog to add some.' : 'No songs found.'}</p>
      ) : (
        <div className="library-list">
          {groups.map((g) => (
            <div key={g.label}>
              <h3 className="section-label">
                {g.label} <span className="count">{g.songs.length}</span>
              </h3>
              <ul className="plain-list tight-list">
                {g.songs.map((s) =>
                  editing === s.id ? (
                    <EditSongRow
                      key={s.id}
                      song={s}
                      genres={genres}
                      onCancel={() => setEditing(null)}
                      onSave={(patch) =>
                        run(async () => {
                          await host.updateSong(s.id, patch);
                          setEditing(null);
                          setReload((r) => r + 1);
                        })
                      }
                    />
                  ) : (
                    <li key={s.id} className="library-row">
                      <span className="song-text">
                        <strong>{s.title}</strong>
                        <span className="muted">
                          {s.artist} <SourceBadge song={s} /> {sort !== 'genre' && <GenreTag song={s} />}
                        </span>
                      </span>
                      <span className="row tight">
                        <button className="icon-btn" title="Edit title, artist, genre" onClick={() => setEditing(s.id)}>
                          ✎
                        </button>
                        {inPlaylist.has(s.id) ? (
                          <button
                            className="btn btn-sm btn-on"
                            onClick={() => run(() => host.removeFromPlaylist(s.id))}
                            title="Remove from playlist"
                          >
                            ✓ In playlist
                          </button>
                        ) : (
                          <button className="btn btn-sm" onClick={() => run(() => host.addToPlaylist([s.id]))}>
                            + Playlist
                          </button>
                        )}
                        {s.origin === 'youtube' && view === 'all' && (
                          <button
                            className="icon-btn danger"
                            title="Delete from catalog"
                            onClick={() =>
                              confirm(`Delete "${s.title}" from the catalog for all parties?`) &&
                              run(() => host.deleteSong(s.id)).then(() => setReload((r) => r + 1))
                            }
                          >
                            🗑
                          </button>
                        )}
                      </span>
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
        </div>
      )}

      <SavedPlaylists
        state={state}
        run={run}
        host={host}
        playlists={playlists}
        onChanged={onPlaylistsChanged}
        onSignIn={onSignIn}
        setToast={setToast}
      />
      <AddSongs host={host} run={run} onAdded={() => setReload((r) => r + 1)} setToast={setToast} />
    </section>
  );
}

function SavedPlaylists({
  state,
  run,
  host,
  playlists,
  onChanged,
  onSignIn,
  setToast,
}: {
  state: PartyState;
  run: Run;
  host: HostApi;
  playlists: SavedPlaylist[] | null;
  onChanged: () => void;
  onSignIn: () => void;
  setToast: (s: string) => void;
}) {
  const [name, setName] = useState('');
  const count = state.playlistSongIds.length;

  return (
    <details className="add-songs saved-playlists">
      <summary>Saved playlists{playlists ? ` (${playlists.length})` : ''}</summary>
      {playlists === null ? (
        <p className="muted small">
          <button type="button" className="link-btn" onClick={onSignIn}>
            Sign in
          </button>{' '}
          to save this party's playlist and reuse it at future parties.
        </p>
      ) : (
        <>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api.createPlaylist(name, state.playlistSongIds);
                setName('');
                onChanged();
                setToast(`Saved "${name.trim()}" (${count} songs)`);
              });
            }}
          >
            <input
              className="grow"
              placeholder="Name, e.g. 90s Night"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
            />
            <button className="btn btn-sm" disabled={!name.trim() || count === 0}>
              Save current playlist ({count})
            </button>
          </form>
          {playlists.length === 0 ? (
            <p className="muted small">No saved playlists yet.</p>
          ) : (
            <ul className="plain-list tight-list">
              {playlists.map((pl) => (
                <li key={pl.id} className="library-row">
                  <span className="song-text">
                    <strong>{pl.name}</strong>
                    <span className="muted small">
                      {pl.songIds.length} songs · updated {new Date(pl.updatedAt).toLocaleDateString()}
                    </span>
                  </span>
                  <span className="row tight">
                    <button
                      className="btn btn-sm"
                      title="Replace this party's playlist with this one"
                      onClick={() => {
                        if (count > 0 && !confirm(`Replace this party's playlist (${count} songs) with "${pl.name}" (${pl.songIds.length} songs)?`))
                          return;
                        run(() => host.replacePlaylist(pl.songIds)).then(() => setToast(`Loaded "${pl.name}"`));
                      }}
                    >
                      Load
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      title="Overwrite with this party's current playlist"
                      disabled={count === 0}
                      onClick={() =>
                        confirm(`Overwrite "${pl.name}" with this party's ${count} songs?`) &&
                        run(async () => {
                          await api.updatePlaylist(pl.id, { songIds: state.playlistSongIds });
                          onChanged();
                          setToast(`Updated "${pl.name}"`);
                        })
                      }
                    >
                      Update
                    </button>
                    <button
                      className="icon-btn danger"
                      title="Delete saved playlist"
                      onClick={() =>
                        confirm(`Delete the saved playlist "${pl.name}"?`) &&
                        run(async () => {
                          await api.deletePlaylist(pl.id);
                          onChanged();
                        })
                      }
                    >
                      🗑
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </details>
  );
}

function EditSongRow({
  song,
  genres,
  onSave,
  onCancel,
}: {
  song: Song;
  genres: string[];
  onSave: (patch: { title: string; artist: string; genre: string }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(song.title);
  const [artist, setArtist] = useState(song.artist);
  const [genre, setGenre] = useState(song.genre ?? '');
  return (
    <li className="library-row editing">
      <form
        className="edit-song"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ title, artist, genre });
        }}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      >
        <input aria-label="Title" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />
        <input aria-label="Artist" placeholder="Artist" value={artist} onChange={(e) => setArtist(e.target.value)} />
        <input
          aria-label="Genre"
          placeholder="Genre"
          list="genre-options"
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
        />
        <datalist id="genre-options">
          {genres.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
        <div className="row tight">
          <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-sm btn-primary">Save</button>
        </div>
      </form>
    </li>
  );
}

function AddSongs({
  host,
  run,
  onAdded,
  setToast,
}: {
  host: HostApi;
  run: Run;
  onAdded: () => void;
  setToast: (s: string) => void;
}) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [busy, setBusy] = useState('');
  const [importWhole, setImportWhole] = useState(true);
  const [skipped, setSkipped] = useState<{ videoId: string; reason: string }[]>([]);

  const listId = playlistIdFromUrl(url);
  const isVideoInList = !!listId && hasVideoId(url);
  const importing = !!listId && (importWhole || !isVideoInList);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSkipped([]);
    try {
      if (importing) {
        setBusy('Finding playlist…');
        const info = await host.playlistInfo(listId!);
        const ids = await fetchPlaylistVideoIds(listId!, (i) =>
          setBusy(i === 0 ? `Reading “${info.title}”…` : `Reading “${info.title}” (skipping ${i} blocked video${i === 1 ? '' : 's'})…`),
        );
        setBusy(`Looking up ${ids.length} videos…`);
        const r = await host.importYouTubeVideos(ids);
        const parts = [`“${info.title}”: imported ${r.added} new song${r.added === 1 ? '' : 's'}`];
        if (r.existing) parts.push(`${r.existing} already in the catalog`);
        if (r.skipped.length) parts.push(`${r.skipped.length} skipped`);
        setToast(parts.join(', ') + '. All added to your playlist.');
        setSkipped(r.skipped);
      } else {
        setBusy('Adding…');
        const song = await host.addYouTube(url, title, artist);
        setToast(`Added "${song.title}" to the catalog and your playlist`);
      }
      setUrl('');
      setTitle('');
      setArtist('');
      onAdded();
    } catch (err) {
      setToast((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  return (
    <details className="add-songs">
      <summary>Add songs</summary>
      <form className="stack tight" onSubmit={submit}>
        <strong>From YouTube</strong>
        <p className="muted small">
          Paste a YouTube video or playlist link. Videos that can't play outside YouTube are skipped.
        </p>
        <input
          placeholder="Video or playlist link: https://www.youtube.com/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
        {isVideoInList && (
          <label className="toggle">
            <input type="checkbox" checked={importWhole} onChange={(e) => setImportWhole(e.target.checked)} />
            <span>Import the whole playlist</span>
          </label>
        )}
        {!importing && (
          <div className="row">
            <input className="grow" placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
            <input className="grow" placeholder="Artist (optional)" value={artist} onChange={(e) => setArtist(e.target.value)} />
          </div>
        )}
        <button className="btn" disabled={!!busy || !url.trim()}>
          {busy || (importing ? 'Import playlist' : 'Add YouTube song')}
        </button>
        {skipped.length > 0 && (
          <details className="skipped">
            <summary className="small muted">{skipped.length} video{skipped.length === 1 ? '' : 's'} skipped</summary>
            <ul className="small muted">
              {skipped.map((s) => (
                <li key={s.videoId}>
                  <a href={`https://www.youtube.com/watch?v=${s.videoId}`} target="_blank" rel="noreferrer">
                    {s.videoId}
                  </a>{' '}
                  · {s.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
      </form>
      <div className="stack tight">
        <strong>From files</strong>
        <p className="muted small">
          Put files in the server's <code>media</code> folder as <code>Artist - Title.mp4</code>, or as{' '}
          <code>Artist - Title.mp3</code> with a matching <code>.lrc</code> lyrics file. Then rescan.
        </p>
        <button
          className="btn btn-sm"
          onClick={() =>
            run(async () => {
              const r = await host.rescan();
              setToast(`Found ${r.total} songs in the media folder`);
              onAdded();
            })
          }
        >
          Rescan media folder
        </button>
      </div>
    </details>
  );
}

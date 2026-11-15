import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../lib/api.ts';
import { storage } from '../lib/storage.ts';
import { useAccount } from '../lib/account.ts';
import { useConfig } from '../lib/joinUrl.ts';
import { Logo } from '../components/common.tsx';
import { AccountModal } from '../components/AccountModal.tsx';
import type { PartyMode } from '../shared/types.ts';

export function Home() {
  const nav = useNavigate();
  const { me, user, refresh } = useAccount();
  const config = useConfig();
  const mustSignIn = !!config?.requireAccountToHost && !user;
  const [name, setName] = useState('');
  const [mode, setMode] = useState<PartyMode>('open');
  const [playlistId, setPlaylistId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [showAccount, setShowAccount] = useState(false);

  // Parties from the account plus ones created anonymously on this device.
  const local = storage.hostedParties();
  const accountCodes = new Set(me?.parties.map((p) => p.code));
  const parties = [
    ...(me?.parties ?? []).map((p) => ({ code: p.code, name: p.name, createdAt: p.createdAt, saved: true })),
    ...local.filter((p) => !accountCodes.has(p.code)).map((p) => ({ ...p, saved: false })),
  ].sort((a, b) => b.createdAt - a.createdAt);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api.createParty(name, mode, playlistId || undefined);
      storage.saveHostedParty({
        code: r.code,
        name: name.trim() || 'Karaoke Night',
        hostToken: r.hostToken,
        stageToken: r.stageToken,
        createdAt: Date.now(),
      });
      if (user) await refresh(); // the new party now belongs to the account
      nav(`/host/${r.code}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page home">
      <div className="account-bar">
        <Link to="/help" className="btn btn-sm btn-ghost">
          Help
        </Link>
        {user ? (
          <>
            <span className="muted small">
              Signed in as <strong>{user.name}</strong>
            </span>
            <button
              className="btn btn-sm btn-ghost"
              onClick={async () => {
                await api.logout();
                refresh();
              }}
            >
              Sign out
            </button>
          </>
        ) : (
          <button className="btn btn-sm" onClick={() => setShowAccount(true)}>
            Host sign in
          </button>
        )}
      </div>

      <header className="home-hero">
        <Logo />
        <p className="tagline">Run a karaoke night from your phone. Guests scan a code, pick a song, and join the queue.</p>
      </header>

      <div className="home-grid">
        <form className="card" onSubmit={create}>
          <h2>Host a party</h2>
          <label className="field">
            <span>Party name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Karaoke Night" maxLength={60} />
          </label>
          <fieldset className="field">
            <span>Song list</span>
            <div className="choice-grid">
              <label className={`choice ${mode === 'open' ? 'selected' : ''}`}>
                <input type="radio" name="mode" checked={mode === 'open'} onChange={() => setMode('open')} />
                <strong>Whole catalog</strong>
                <small>Guests can pick any song in the library.</small>
              </label>
              <label className={`choice ${mode === 'curated' ? 'selected' : ''}`}>
                <input type="radio" name="mode" checked={mode === 'curated'} onChange={() => setMode('curated')} />
                <strong>Curated playlist</strong>
                <small>Guests only see the songs you pick.</small>
              </label>
            </div>
          </fieldset>
          {user && (me?.playlists.length ?? 0) > 0 && (
            <label className="field">
              <span>Start from a saved playlist</span>
              <select value={playlistId} onChange={(e) => setPlaylistId(e.target.value)}>
                <option value="">None</option>
                {me!.playlists.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.songIds.length} songs)
                  </option>
                ))}
              </select>
            </label>
          )}
          {error && <p className="error">{error}</p>}
          {mustSignIn ? (
            <button type="button" className="btn btn-primary btn-lg" onClick={() => setShowAccount(true)}>
              Sign in to host
            </button>
          ) : (
            <button className="btn btn-primary btn-lg" disabled={busy}>
              {busy ? 'Creating…' : 'Create party'}
            </button>
          )}
          {!user && !mustSignIn && (
            <p className="muted small center">
              <button type="button" className="link-btn" onClick={() => setShowAccount(true)}>
                Sign in
              </button>{' '}
              to save your parties and playlists.
            </p>
          )}
        </form>

        <div className="stack">
          <form
            className="card"
            onSubmit={(e) => {
              e.preventDefault();
              if (joinCode.trim()) nav(`/p/${joinCode.trim().toUpperCase()}`);
            }}
          >
            <h2>Join a party</h2>
            <div className="row">
              <input
                className="code-input"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="CODE"
                maxLength={4}
                autoCapitalize="characters"
              />
              <button className="btn">Join</button>
            </div>
          </form>

          {parties.length > 0 && (
            <div className="card">
              <h2>Your parties</h2>
              <ul className="plain-list">
                {parties.map((p) => (
                  <li key={p.code} className="row spread">
                    <Link to={`/host/${p.code}`}>
                      <strong>{p.name}</strong> <span className="muted mono">{p.code}</span>
                    </Link>
                    <span className="muted small">
                      {p.saved ? '☁︎ ' : ''}
                      {new Date(p.createdAt).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {showAccount && <AccountModal onClose={() => setShowAccount(false)} />}
    </div>
  );
}

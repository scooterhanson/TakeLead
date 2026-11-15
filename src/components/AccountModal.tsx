import { useState, type FormEvent } from 'react';
import { api } from '../lib/api.ts';
import { refreshAccount } from '../lib/account.ts';
import { useConfig } from '../lib/joinUrl.ts';

type Mode = 'login' | 'register' | 'forgot';

/** Sign in, create an account, or request a password reset. */
export function AccountModal({ onClose, intro }: { onClose: () => void; intro?: string }) {
  const config = useConfig();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const canRegister = config?.allowRegistration !== false;

  function switchTo(m: Mode) {
    setMode(m);
    setError('');
    setSent(false);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'forgot') {
        await api.forgotPassword(email);
        setSent(true);
        return;
      }
      if (mode === 'login') await api.login(email, password);
      else await api.register(email, password, name);
      await refreshAccount();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const title = mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create a host account' : 'Reset your password';

  return (
    <div className="sheet-backdrop modal-backdrop" onClick={onClose}>
      <form className="sheet modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{title}</h2>
        {mode !== 'forgot' && (
          <p className="muted small">{intro ?? 'Save your parties and playlists, and host from any device.'}</p>
        )}
        {mode !== 'forgot' && canRegister && (
          <nav className="tabs tabs-sm">
            <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => switchTo('login')}>
              Sign in
            </button>
            <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => switchTo('register')}>
              Create account
            </button>
          </nav>
        )}

        {mode === 'forgot' && sent ? (
          <p>
            If <strong>{email}</strong> has an account, we've sent it a link to reset the password. The link works for one
            hour. Check your spam folder if it doesn't arrive.
          </p>
        ) : (
          <>
            {mode === 'forgot' && <p className="muted small">Enter your account email and we'll send you a reset link.</p>}
            {mode === 'register' && (
              <label className="field">
                <span>Your name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={40} required />
              </label>
            )}
            <label className="field">
              <span>Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus />
            </label>
            {mode !== 'forgot' && (
              <label className="field">
                <span>Password{mode === 'register' && ' (8+ characters)'}</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  minLength={mode === 'register' ? 8 : undefined}
                  required
                />
              </label>
            )}
            {mode === 'login' && (
              <button type="button" className="link-btn small left" onClick={() => switchTo('forgot')}>
                Forgot password?
              </button>
            )}
          </>
        )}

        {error && <p className="error">{error}</p>}
        <div className="row">
          {mode === 'forgot' ? (
            <button type="button" className="btn btn-ghost" onClick={() => switchTo('login')}>
              Back to sign in
            </button>
          ) : (
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
          )}
          {!(mode === 'forgot' && sent) && (
            <button className="btn btn-primary grow" disabled={busy}>
              {busy ? 'One moment…' : mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : 'Send reset link'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

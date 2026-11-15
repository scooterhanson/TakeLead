import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api } from '../lib/api.ts';
import { refreshAccount } from '../lib/account.ts';
import { Logo } from '../components/common.tsx';

/** Opened from the link in a password-reset email. */
export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const nav = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError("The passwords don't match.");
    setBusy(true);
    setError('');
    try {
      await api.resetPassword(token, password);
      await refreshAccount();
      nav('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page centered">
      <Logo />
      <form className="card narrow" onSubmit={submit}>
        <h2>Choose a new password</h2>
        {!token ? (
          <p className="error">This link is missing its reset code. Open the link from the email again.</p>
        ) : (
          <>
            <label className="field">
              <span>New password (8+ characters)</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required autoFocus />
            </label>
            <label className="field">
              <span>Type it again</span>
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={8} required />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save password and sign in'}
            </button>
          </>
        )}
        <Link to="/" className="small">
          Back to TakeLead
        </Link>
      </form>
    </div>
  );
}

/**
 * Host accounts: email + password (scrypt), session cookie (httpOnly, SameSite=Lax).
 * Accounts are optional. Anyone can still create a party anonymously.
 */
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { Request, Response } from 'express';
import { db } from './db.ts';
import { HttpError } from './errors.ts';
import { sendMail } from './mail.ts';
import type { User } from '../src/shared/types.ts';

const scrypt = promisify(crypto.scrypt) as (
  pw: string,
  salt: Buffer,
  len: number,
  opts: crypto.ScryptOptions,
) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SESSION_COOKIE = 'nos_session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const RESET_MS = 60 * 60 * 1000; // reset links work for 1 hour

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64, SCRYPT);
  return ['scrypt', salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(password: string, stored: string) {
  const [, saltB64, keyB64] = stored.split('$');
  if (!saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, SCRYPT);
  return crypto.timingSafeEqual(key, expected);
}

function cookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try {
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        /* ignore malformed cookie */
      }
    }
  }
  return out;
}

export function currentUser(req: Request): User | null {
  const token = cookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id_hash = ? AND s.expires_at > ?`,
    )
    .get(sha256(token), Date.now()) as User | undefined;
  return row ?? null;
}

export function requireUser(req: Request): User {
  const user = currentUser(req);
  if (!user) throw new HttpError(401, 'Sign in first.');
  return user;
}

function startSession(req: Request, res: Response, userId: string) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (id_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
    sha256(token),
    userId,
    Date.now() + SESSION_MS,
  );
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: SESSION_MS, path: '/' });
}

/* Simple per-IP limiter for login/register attempts. */
const attempts = new Map<string, { n: number; reset: number }>();
function rateLimit(req: Request) {
  const key = req.ip ?? 'unknown';
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || a.reset < now) attempts.set(key, { n: 1, reset: now + 10 * 60 * 1000 });
  else if (++a.n > 20) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function register(req: Request, res: Response): Promise<User> {
  rateLimit(req);
  if (process.env.ALLOW_REGISTRATION === 'false') throw new HttpError(403, 'New accounts are turned off on this server.');
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  const name = String(req.body?.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!EMAIL_RE.test(email) || email.length > 200) throw new HttpError(400, 'Enter a valid email address.');
  if (password.length < 8) throw new HttpError(400, 'Passwords need at least 8 characters.');
  if (password.length > 200) throw new HttpError(400, 'That password is too long.');
  if (!name) throw new HttpError(400, 'Enter your name.');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email))
    throw new HttpError(409, 'There is already an account with that email. Try signing in.');
  const id = crypto.randomBytes(12).toString('base64url');
  db.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    email,
    name,
    await hashPassword(password),
    Date.now(),
  );
  startSession(req, res, id);
  return { id, email, name };
}

export async function login(req: Request, res: Response): Promise<User> {
  rateLimit(req);
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as
    | { id: string; email: string; name: string; password_hash: string }
    | undefined;
  // Always do the expensive hash so response time doesn't reveal whether the email exists.
  let ok = false;
  if (row) ok = await verifyPassword(password, row.password_hash);
  else await hashPassword(password);
  if (!row || !ok) throw new HttpError(401, 'Wrong email or password.');
  startSession(req, res, row.id);
  return { id: row.id, email: row.email, name: row.name };
}

export function logout(req: Request, res: Response) {
  const token = cookies(req)[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(sha256(token));
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/* ------------------------------------------------------------ password reset */

/** Base URL for links in emails. Set PUBLIC_URL in production. */
function siteUrl(req: Request) {
  return (process.env.PUBLIC_URL ?? `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

/**
 * Email a reset link if the address has an account. The response is the same either way,
 * so this can't be used to find out who has an account.
 */
export async function requestPasswordReset(req: Request) {
  rateLimit(req);
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const user = db.prepare('SELECT id, name, email FROM users WHERE email = ?').get(email) as User | undefined;
  if (!user) return;
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM password_resets WHERE user_id = ? OR expires_at < ?').run(user.id, Date.now());
  db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
    sha256(token),
    user.id,
    Date.now() + RESET_MS,
  );
  const link = `${siteUrl(req)}/reset-password?token=${token}`;
  await sendMail(
    user.email,
    'Reset your TakeLead password',
    [
      `Hi ${user.name},`,
      '',
      'Someone asked to reset the password for your TakeLead account. To choose a new one, open this link:',
      '',
      link,
      '',
      'The link works for one hour. If you didn\'t ask for this, ignore this email; your password stays the same.',
    ].join('\n'),
  );
}

export async function resetPassword(req: Request, res: Response): Promise<User> {
  rateLimit(req);
  const token = String(req.body?.token ?? '');
  const password = String(req.body?.password ?? '');
  if (password.length < 8) throw new HttpError(400, 'Passwords need at least 8 characters.');
  if (password.length > 200) throw new HttpError(400, 'That password is too long.');
  const row = db
    .prepare('SELECT user_id FROM password_resets WHERE token_hash = ? AND expires_at > ?')
    .get(sha256(token), Date.now()) as { user_id: string } | undefined;
  if (!row) throw new HttpError(400, 'This reset link has expired or was already used. Request a new one.');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), row.user_id);
  // One use only, and sign out every other device.
  db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(row.user_id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);
  startSession(req, res, row.user_id);
  return db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(row.user_id) as unknown as User;
}

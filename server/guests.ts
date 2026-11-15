/** Guest profiles: display name, short blurb and avatar photo, keyed by the guest's device id. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, db } from './db.ts';
import { HttpError } from './errors.ts';
import { cleanName, notifyParty, renameGuest } from './party.ts';
import type { GuestProfile } from '../src/shared/types.ts';

export const AVATAR_DIR = path.join(DATA_DIR, 'avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });

const MAX_BLURB = 140;

interface GuestRow {
  id: string;
  name: string;
  blurb: string;
  avatar: string | null;
}

export function assertGuestId(id: unknown): string {
  if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) throw new HttpError(400, 'Reload the page and try again.');
  return id;
}

const row = (id: string) => db.prepare('SELECT * FROM guests WHERE id = ?').get(id) as GuestRow | undefined;

export function getProfile(id: string): GuestProfile {
  const r = row(id);
  return { name: r?.name ?? '', blurb: r?.blurb ?? '', avatarUrl: r?.avatar ? `/avatars/${r.avatar}` : null };
}

/** Parties where this guest is currently in the queue (their profile shows there). */
function activeParties(id: string): string[] {
  return (
    db
      .prepare("SELECT DISTINCT party_code FROM queue WHERE guest_id = ? AND state IN ('queued','current')")
      .all(id) as { party_code: string }[]
  ).map((r) => r.party_code);
}

function ensureRow(id: string) {
  db.prepare("INSERT OR IGNORE INTO guests (id, name, blurb, updated_at) VALUES (?, '', '', ?)").run(id, Date.now());
}

export function saveProfile(id: string, input: { name?: unknown; blurb?: unknown }): GuestProfile {
  ensureRow(id);
  const current = row(id)!;
  const affected = new Set(activeParties(id));
  if (input.name !== undefined) {
    const name = cleanName(input.name);
    if (!name) throw new HttpError(400, 'Enter your name.');
    if (name !== current.name) {
      for (const c of renameGuest(id, name)) affected.add(c);
      db.prepare('UPDATE guests SET name = ? WHERE id = ?').run(name, id);
    }
  }
  if (input.blurb !== undefined) {
    const blurb = String(input.blurb ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_BLURB);
    db.prepare('UPDATE guests SET blurb = ? WHERE id = ?').run(blurb, id);
  }
  db.prepare('UPDATE guests SET updated_at = ? WHERE id = ?').run(Date.now(), id);
  for (const c of affected) notifyParty(c);
  return getProfile(id);
}

/** Identify the image type from its first bytes rather than trusting the upload's content type. */
function imageExt(buf: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function removeFile(file: string | null) {
  if (!file) return;
  fs.rm(path.join(AVATAR_DIR, path.basename(file)), { force: true }, () => {});
}

export function setAvatar(id: string, body: unknown): GuestProfile {
  if (!Buffer.isBuffer(body) || body.length === 0) throw new HttpError(400, 'No image received.');
  const ext = imageExt(body);
  if (!ext) throw new HttpError(400, 'Use a JPEG, PNG or WebP image.');
  ensureRow(id);
  const old = row(id)!.avatar;
  // Random file name: unguessable, and changes on every upload so caches never show a stale photo.
  const file = `${crypto.randomBytes(12).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(AVATAR_DIR, file), body);
  db.prepare('UPDATE guests SET avatar = ?, updated_at = ? WHERE id = ?').run(file, Date.now(), id);
  removeFile(old);
  for (const c of activeParties(id)) notifyParty(c);
  return getProfile(id);
}

export function clearAvatar(id: string): GuestProfile {
  const r = row(id);
  if (r?.avatar) {
    db.prepare('UPDATE guests SET avatar = NULL, updated_at = ? WHERE id = ?').run(Date.now(), id);
    removeFile(r.avatar);
    for (const c of activeParties(id)) notifyParty(c);
  }
  return getProfile(id);
}

/** Host moderation: hide the photo and blurb of the guest behind a queue entry. */
export function hideProfileForEntry(partyCode: string, entryId: string) {
  const entry = db.prepare('SELECT guest_id FROM queue WHERE id = ? AND party_code = ?').get(entryId, partyCode.toUpperCase()) as
    | { guest_id: string | null }
    | undefined;
  if (!entry) throw new HttpError(404, 'That sign-up no longer exists.');
  if (!entry.guest_id) return;
  const r = row(entry.guest_id);
  if (!r) return;
  db.prepare("UPDATE guests SET avatar = NULL, blurb = '', updated_at = ? WHERE id = ?").run(Date.now(), entry.guest_id);
  removeFile(r.avatar);
  for (const c of activeParties(entry.guest_id)) notifyParty(c);
}

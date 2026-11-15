import './env.ts'; // must be first: loads .env before other modules read settings
import express, { type NextFunction, type Request, type Response } from 'express';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { Server } from 'socket.io';
import { HttpError } from './errors.ts';
import {
  MEDIA_DIR,
  addYouTubeSong,
  deleteSong,
  importYouTubeVideos,
  listSongs,
  scanMedia,
  updateSongMeta,
  youTubePlaylistInfo,
} from './catalog.ts';
import { kickEnrichment, onCatalogEnriched, pendingCount } from './enrich.ts';
import { currentUser, login, logout, register, requestPasswordReset, requireUser, resetPassword } from './auth.ts';
import { createPlaylist, deletePlaylist, getPlaylist, listParties, listPlaylists, updatePlaylist } from './account.ts';
import { AVATAR_DIR, assertGuestId, clearAvatar, getProfile, hideProfileForEntry, saveProfile, setAvatar } from './guests.ts';
import {
  addEntry,
  addToPlaylist,
  claimParty,
  deleteParty,
  hostCredentials,
  partyOwner,
  replacePlaylist,
  control,
  createParty,
  getState,
  isHost,
  isStage,
  onPartyChange,
  partySongs,
  removeEntry,
  removeFromPlaylist,
  reorderQueue,
  stageEnded,
  updateParty,
} from './party.ts';
import type { AppConfig, ControlAction } from '../src/shared/types.ts';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
const PROD = process.env.NODE_ENV === 'production';

const app = express();
// Behind Cloudflare Tunnel / a reverse proxy on this machine: trust its X-Forwarded-* headers
// so HTTPS is detected (secure cookies) and rate limits see the visitor's real IP.
app.set('trust proxy', 'loopback');
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.use(express.json({ limit: '100kb' }));
const server = http.createServer(app);
const io = new Server(server);

const room = (code: string) => `party:${code.toUpperCase()}`;
onPartyChange((code) => {
  try {
    io.to(room(code)).emit('state', getState(code));
  } catch {
    /* party gone */
  }
});

const hostToken = (req: Request) => req.get('x-host-token') ?? '';
const code = (req: Request) => String(req.params.code);
/** Host = has the party's host key, or is signed in as the account that owns the party. */
function isHostReq(req: Request) {
  if (isHost(code(req), hostToken(req))) return true;
  const user = currentUser(req);
  return !!user && partyOwner(code(req)) === user.id;
}
const requireHost = (req: Request) => {
  if (!isHostReq(req)) throw new HttpError(403, 'Only the host can do that.');
};
const guestId = (req: Request) => assertGuestId(req.get('x-guest-id'));

function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a): a is os.NetworkInterfaceInfo => !!a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
}

/* ------------------------------------------------------------- public */

app.get('/api/config', (_req, res) => {
  const config: AppConfig = {
    lanAddresses: lanAddresses(),
    publicUrl: process.env.PUBLIC_URL ?? null,
    allowRegistration: process.env.ALLOW_REGISTRATION !== 'false',
    requireAccountToHost: process.env.REQUIRE_ACCOUNT_TO_HOST === 'true',
  };
  res.json(config);
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/parties', (req, res) => {
  const user = currentUser(req);
  if (!user && process.env.REQUIRE_ACCOUNT_TO_HOST === 'true') throw new HttpError(401, 'Sign in to host a party.');
  const songIds = user && req.body?.playlistId ? getPlaylist(user.id, String(req.body.playlistId)).songIds : [];
  res.status(201).json(createParty(req.body?.name, req.body?.mode, { ownerId: user?.id, songIds, theme: req.body?.theme }));
});

app.get('/api/parties/:code', (req, res) => {
  res.json(getState(code(req)));
});

app.get('/api/parties/:code/songs', (req, res) => {
  res.json(partySongs(code(req)));
});

app.post('/api/parties/:code/queue', (req, res) => {
  // Host additions must say so explicitly; a signed-in host using the guest page plays by guest rules.
  const asHost = req.body?.asHost === true;
  if (asHost) requireHost(req);
  res.status(201).json(addEntry(code(req), req.body ?? {}, asHost));
});

app.delete('/api/parties/:code/queue/:entryId', (req, res) => {
  removeEntry(code(req), String(req.params.entryId), {
    host: isHostReq(req),
    guestId: req.get('x-guest-id'),
  });
  res.status(204).end();
});

/* --------------------------------------------------------------- host */

app.get('/api/parties/:code/host-check', (req, res) => {
  requireHost(req);
  res.json({ ok: true });
});

app.patch('/api/parties/:code', (req, res) => {
  requireHost(req);
  updateParty(code(req), req.body ?? {});
  res.json(getState(code(req)));
});

app.post('/api/parties/:code/control', (req, res) => {
  requireHost(req);
  control(code(req), req.body?.action as ControlAction);
  res.json(getState(code(req)));
});

app.post('/api/parties/:code/queue/reorder', (req, res) => {
  requireHost(req);
  reorderQueue(code(req), req.body?.entryIds);
  res.json(getState(code(req)));
});

app.post('/api/parties/:code/playlist', (req, res) => {
  requireHost(req);
  addToPlaylist(code(req), req.body?.songIds);
  res.json(getState(code(req)));
});

app.put('/api/parties/:code/playlist', (req, res) => {
  requireHost(req);
  replacePlaylist(code(req), req.body?.songIds);
  res.json(getState(code(req)));
});

app.post('/api/parties/:code/queue/:entryId/hide-profile', (req, res) => {
  requireHost(req);
  hideProfileForEntry(code(req), String(req.params.entryId));
  res.json(getState(code(req)));
});

app.post('/api/parties/:code/claim', (req, res) => {
  requireHost(req);
  claimParty(code(req), requireUser(req).id);
  res.json({ ok: true });
});

app.delete('/api/parties/:code/playlist/:songId', (req, res) => {
  requireHost(req);
  removeFromPlaylist(code(req), String(req.params.songId));
  res.json(getState(code(req)));
});

/* Catalog management is gated on being the host of some party. */
app.get('/api/parties/:code/catalog', (req, res) => {
  requireHost(req);
  res.json(listSongs());
});

app.post('/api/parties/:code/catalog/youtube', async (req, res) => {
  requireHost(req);
  const song = await addYouTubeSong(req.body ?? {});
  kickEnrichment();
  if (req.body?.addToPlaylist !== false) addToPlaylist(code(req), [song.id]);
  res.status(201).json(song);
});

app.get('/api/parties/:code/catalog/youtube-playlist/:listId', async (req, res) => {
  requireHost(req);
  res.json(await youTubePlaylistInfo(String(req.params.listId)));
});

app.post('/api/parties/:code/catalog/youtube-playlist', async (req, res) => {
  requireHost(req);
  const result = await importYouTubeVideos(req.body?.videoIds);
  kickEnrichment();
  if (req.body?.addToPlaylist !== false) addToPlaylist(code(req), result.songIds);
  onPartyChangeAll();
  res.json(result);
});

app.post('/api/parties/:code/catalog/rescan', (req, res) => {
  requireHost(req);
  const result = scanMedia();
  kickEnrichment();
  onPartyChangeAll();
  res.json(result);
});

app.get('/api/parties/:code/catalog/status', (req, res) => {
  requireHost(req);
  res.json({ pendingLookups: pendingCount() });
});

app.patch('/api/parties/:code/catalog/:songId', (req, res) => {
  requireHost(req);
  const song = updateSongMeta(String(req.params.songId), req.body ?? {});
  onPartyChangeAll();
  res.json(song);
});

app.delete('/api/parties/:code/catalog/:songId', (req, res) => {
  requireHost(req);
  deleteSong(String(req.params.songId));
  onPartyChangeAll();
  res.status(204).end();
});

onCatalogEnriched(() => onPartyChangeAll());

function onPartyChangeAll() {
  for (const r of io.sockets.adapter.rooms.keys()) {
    if (r.startsWith('party:')) io.to(r).emit('catalog-changed');
  }
}

/* ------------------------------------------------------------- guests */

app.get('/api/guests/me', (req, res) => {
  res.json(getProfile(guestId(req)));
});

app.put('/api/guests/me', (req, res) => {
  res.json(saveProfile(guestId(req), req.body ?? {}));
});

app.put(
  '/api/guests/me/avatar',
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '1mb' }),
  (req, res) => {
    res.json(setAvatar(guestId(req), req.body));
  },
);

app.delete('/api/guests/me/avatar', (req, res) => {
  res.json(clearAvatar(guestId(req)));
});

/* ----------------------------------------------------------- accounts */

app.post('/api/auth/register', async (req, res) => {
  res.status(201).json({ user: await register(req, res) });
});

app.post('/api/auth/login', async (req, res) => {
  res.json({ user: await login(req, res) });
});

app.post('/api/auth/forgot', async (req, res) => {
  await requestPasswordReset(req);
  res.json({ ok: true });
});

app.post('/api/auth/reset', async (req, res) => {
  res.json({ user: await resetPassword(req, res) });
});

app.post('/api/auth/logout', (req, res) => {
  logout(req, res);
  res.status(204).end();
});

app.get('/api/me', (req, res) => {
  const user = currentUser(req);
  res.json(user ? { user, parties: listParties(user.id), playlists: listPlaylists(user.id) } : { user: null, parties: [], playlists: [] });
});

/** Lets a host who signs in on a new device pick up their party's keys. */
app.get('/api/me/parties/:code/credentials', (req, res) => {
  const user = requireUser(req);
  if (partyOwner(code(req)) !== user.id) throw new HttpError(403, "That party isn't in your account.");
  res.json(hostCredentials(code(req)));
});

app.delete('/api/me/parties/:code', (req, res) => {
  const user = requireUser(req);
  if (partyOwner(code(req)) !== user.id) throw new HttpError(403, "That party isn't in your account.");
  deleteParty(code(req));
  res.status(204).end();
});

app.post('/api/me/playlists', (req, res) => {
  res.status(201).json(createPlaylist(requireUser(req).id, req.body ?? {}));
});

app.put('/api/me/playlists/:id', (req, res) => {
  res.json(updatePlaylist(requireUser(req).id, String(req.params.id), req.body ?? {}));
});

app.delete('/api/me/playlists/:id', (req, res) => {
  deletePlaylist(requireUser(req).id, String(req.params.id));
  res.status(204).end();
});

/* -------------------------------------------------------- static files */

app.use('/avatars', express.static(AVATAR_DIR, { fallthrough: false, maxAge: '30d', immutable: true }));

app.use('/media', express.static(MEDIA_DIR, { fallthrough: false, maxAge: '1h' }));

if (PROD) {
  const dist = path.resolve('dist');
  if (!fs.existsSync(dist)) console.warn('dist/ not found. Run `npm run build` first.');
  app.use(express.static(dist, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
}

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  const status = (err as { status?: number })?.status;
  if (status && status < 500) return res.status(status).json({ error: (err as Error).message });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

/* ------------------------------------------------------------ sockets */

io.on('connection', (socket) => {
  socket.on('join', (rawCode: unknown, ack?: (res: unknown) => void) => {
    const c = String(rawCode ?? '').toUpperCase();
    try {
      const state = getState(c);
      for (const r of socket.rooms) if (r.startsWith('party:')) socket.leave(r);
      socket.join(room(c));
      ack?.({ ok: true, state });
    } catch {
      ack?.({ ok: false });
    }
  });

  type StageMsg = { code: string; k: string; entryId: string; time?: number; duration?: number; message?: string };
  const fromStage = (m: StageMsg) => m && typeof m.code === 'string' && isStage(m.code, m.k);

  socket.on('stage:progress', (m: StageMsg) => {
    if (!fromStage(m)) return;
    socket.to(room(m.code)).emit('progress', { entryId: m.entryId, time: m.time ?? 0, duration: m.duration ?? 0 });
  });

  socket.on('stage:ended', (m: StageMsg) => {
    if (!fromStage(m)) return;
    try {
      stageEnded(m.code, m.entryId);
    } catch {
      /* ignore */
    }
  });

  socket.on('stage:error', (m: StageMsg) => {
    if (!fromStage(m)) return;
    io.to(room(m.code)).emit('stage:error', { entryId: m.entryId, message: String(m.message ?? '').slice(0, 200) });
  });
});

/* -------------------------------------------------------------- start */

const { total } = scanMedia();
kickEnrichment();
server.listen(PORT, HOST, () => {
  console.log(`\n🎤 TakeLead server on http://localhost:${PORT}  (${total} media songs in ${MEDIA_DIR})`);
  if (!PROD) console.log('   Dev UI: http://localhost:5173');
  for (const ip of lanAddresses()) console.log(`   LAN:    http://${ip}:${PROD ? PORT : 5173}`);
});

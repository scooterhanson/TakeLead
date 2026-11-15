<img src="public/takelead.png" alt="" width="96" align="right" />

# TakeLead

A karaoke party app. The host creates a party and picks the songs. Guests scan a QR code, choose a song on their phone, and join the queue. A Now Playing screen on the TV plays each singer's track.

To put it on a server, see [DEPLOY.md](DEPLOY.md).

## Development

```bash
npm install
npm run dev          # API on :3000, web app on :5173
```

Open http://localhost:5173. QR codes use your computer's network address, so phones on the same Wi-Fi can join.

| Command | What it does |
|---|---|
| `npm run build` | Type-check and build the web app into `dist/` |
| `npm start` | Run the built app on one port (3000) |
| `npm run demo-songs` | Regenerate the public-domain demo songs |
| `npm run backup` | Copy the database and guest photos to `backups/` |
| `npm run package` | Build and bundle a release into `release/` |

Settings come from `.env`. See `.env.example` for the full list.

## Screens

| Screen | Address | Used by |
|---|---|---|
| Host dashboard | `/host/CODE` | The host: playback, queue order, songs, theme, invites |
| Guest | `/p/CODE` | Guests: pick songs, see the queue, edit their profile |
| Now Playing | `/stage/CODE?k=…` | The TV. Open it from the host dashboard so it can advance the queue. Add `&autostart=1` for TV browsers that allow sound without a click |
| Help | `/help` | Everyone |

When a song ends, the TV shows the next singer's name and waits for the host to press Play.

## Features

- **Songs:**
  - YouTube videos and playlists (pasted as links), plus your own files in `media/`.
  - Sort by artist, song or genre.
  - Genres and corrected names come from the iTunes Search API. A match only counts if the artist and title both appear in the original video title or filename. Hosts can edit any song.
- **Song list for guests:** either the whole catalog or only the party playlist.
- **Guest rules:** each song can be in the queue once, and names are unique within a party (not case-sensitive). The host's **+ Add singer** skips both rules.
- **Guest profiles:** name, photo and a short line about themselves, shown in the queue and on the TV. The host can remove any photo or line.
  - Photos are cropped to 320×320 on the phone before upload, which also strips location data.
- **Host accounts** (optional):
  - Saved parties and saved playlists.
  - Host from any device.
  - Password reset by email.
- **Themes:** Classic (default), Light, Dark, Retro 60s, 70s, 80s, 90s (Windows 95) and '00s (Windows XP). The theme applies to the TV and every guest's phone.

## Song sources

1. **YouTube.** Paste a video or playlist link in **Song library → Add songs**.
   - Playlists must be public or unlisted. YouTube returns about the first 200 videos.
   - Videos whose owners block playback on other sites are skipped.
   - Ads can play unless the TV's browser is signed in to YouTube Premium.
2. **Audio + LRC lyrics.** Put `Artist - Title.mp3` and `Artist - Title.lrc` in `media/`. The app draws the lyrics, word by word when the LRC file has word timings.
   - Free sources: public-domain songs, Creative Commons backing tracks from ccMixter or the Free Music Archive, and synced lyrics from lrclib.net.
3. **Karaoke video files.** `Artist - Title.mp4` or `.webm` in `media/`.

Most commercial karaoke tracks are copyrighted. YouTube links and files you own are fine for private parties. Public or paid use needs proper licensing.

## Code layout

```
server/        Express, Socket.IO, SQLite (node:sqlite, Node 22.13+)
  index.ts     routes, sockets, static files
  party.ts     parties, queue and playback
  catalog.ts   media folder scan, YouTube songs
  enrich.ts    background genre lookup
  auth.ts      accounts, sessions, password reset
  account.ts   saved parties and playlists
  guests.ts    guest profiles and photos
  mail.ts      outgoing email (SMTP)
src/           React web app
  pages/       Home, Host, Guest, Stage, ResetPassword
  components/  players, help, theme picker, sign-in
  themes.css   the eight themes
deploy/        service files for macOS and Linux, Cloudflare Tunnel example
scripts/       demo songs, backup, packaging
```

The server keeps the queue and playback state and sends every change to the party over Socket.IO. The TV reports progress and song endings back to the server. Only the host and TV keys can control playback.

## Possible next steps

- CD+G (`.cdg` + `.mp3`) playback
- Upload song files from the host dashboard
- Search YouTube inside the app (needs a YouTube Data API key)
- Limit songs per guest, or rotate singers fairly
- Duets (two names on one sign-up)

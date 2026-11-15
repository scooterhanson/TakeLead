# Running TakeLead at home

This guide puts TakeLead on an always-on computer at home and makes it reachable at your own domain through a free Cloudflare Tunnel. You don't need to open ports on your router, and your home IP address stays private.

**You need:**

- A computer that stays on: a Mac, a Linux PC, or a Raspberry Pi 4/5 running 64-bit Raspberry Pi OS.
- Node.js 22.13 or newer (24 LTS recommended).
- A domain name. It can stay registered at HostGator.
- A free Cloudflare account.
- Optional: an email mailbox for password-reset emails. A HostGator mailbox works.

Steps 1–4 get TakeLead running at home. Step 5 puts it on your domain.

---

## 1. Install Node.js

- **Mac:** install [Homebrew](https://brew.sh), then run `brew install node`.
- **Linux / Raspberry Pi:** follow the instructions at [nodejs.org/en/download](https://nodejs.org/en/download) for your system.

Check the version with `node -v`. It must be 22.13 or higher.

## 2. Unpack and install

Copy `takelead-1.0.0.tar.gz` to the computer, then:

```bash
tar -xzf takelead-1.0.0.tar.gz
mv takelead-1.0.0 ~/takelead        # or /opt/takelead on Linux
cd ~/takelead
npm ci --omit=dev
```

## 3. Configure

```bash
cp .env.example .env
```

Open `.env` in a text editor and set:

- `PUBLIC_URL`: the address people will use, such as `https://karaoke.yourdomain.com`.
- The `SMTP_` lines, if you want password-reset emails (see below).

The other settings can stay as they are for now.

### Password-reset email through HostGator

1. In HostGator's cPanel, open **Email Accounts** and create a mailbox such as `noreply@yourmaindomain.com`.
   - Use a domain whose email stays at HostGator. If you move the TakeLead domain's DNS to Cloudflare in step 5, email for that domain stops working unless you copy its mail (MX) records to Cloudflare.
2. In `.env`, set:
   ```
   SMTP_HOST=mail.yourmaindomain.com
   SMTP_PORT=465
   SMTP_USER=noreply@yourmaindomain.com
   SMTP_PASS=the mailbox password
   MAIL_FROM=TakeLead <noreply@yourmaindomain.com>
   ```
   cPanel's **Connect Devices** page for the mailbox lists the exact server name if `mail.yourdomain` doesn't work.

If you skip this, reset links are printed in the server log instead of emailed. That's fine if you're the only host.

## 4. Start it and keep it running

Test it first:

```bash
npm start
```

Open http://localhost:3000, click **Host sign in**, and create your account. If you don't want anyone else making accounts, set `ALLOW_REGISTRATION=false` in `.env`. Stop the test with Ctrl+C.

Then set it up to start on its own and restart if it stops.

**Mac**

1. Open `deploy/com.takelead.server.plist`. Replace `/Users/YOU/takelead` with your folder (3 places), and check the node path with `which node`.
2. Run:
   ```bash
   cp deploy/com.takelead.server.plist ~/Library/LaunchAgents/
   launchctl load ~/Library/LaunchAgents/com.takelead.server.plist
   ```
3. Stop the Mac from sleeping. In **System Settings → Energy** (or **Battery → Options** on a laptop), turn on **Prevent automatic sleeping when the display is off**.

The log is in `takelead.log` in the TakeLead folder. To stop TakeLead: `launchctl unload ~/Library/LaunchAgents/com.takelead.server.plist`

**Linux / Raspberry Pi**

```bash
sudo useradd --system --home /opt/takelead takelead
sudo chown -R takelead: /opt/takelead
sudo cp deploy/takelead.service /etc/systemd/system/
sudo systemctl enable --now takelead
```

Check it with `systemctl status takelead`. Read the log with `journalctl -u takelead -f`.

## 5. Put it on your domain with Cloudflare Tunnel

**a. Move the domain's DNS to Cloudflare**

1. Sign up at [cloudflare.com](https://dash.cloudflare.com/sign-up). Choose **Add a domain** and pick the **Free** plan.
2. Cloudflare gives you two nameservers. In the HostGator customer portal, open the domain and change its nameservers to those two.
3. Wait until Cloudflare says the domain is active. This usually takes minutes, but can take up to a day.

**b. Create the tunnel**

1. In the Cloudflare dashboard, open **Zero Trust → Networks → Tunnels** and click **Create a tunnel**. Choose **Cloudflared** and name it `takelead`.
2. Pick your computer's system. Cloudflare shows the commands to install the connector, which look like `brew install cloudflared` and `sudo cloudflared service install <long token>`. Run them on the home computer. The connector then starts at boot by itself.
3. Add a **public hostname**:
   - Subdomain: e.g. `karaoke` (or leave it empty to use the bare domain).
   - Domain: yours.
   - Service type: **HTTP**. URL: `localhost:3000`.
4. Save, then open your address. It should load TakeLead over HTTPS.

Cloudflare renames dashboard menus from time to time. If something above doesn't match, search their docs for "create a tunnel dashboard".

Make sure `PUBLIC_URL` in `.env` matches this address exactly, then restart TakeLead.

---

## Day to day

**Back up.** Run `npm run backup` in the TakeLead folder. It copies the database and guest photos into `backups/<date>/` and works while the app is running. Copy that folder somewhere else now and then.

**Update to a new version.**

1. Stop TakeLead.
2. Unpack the new archive over the old folder. Keep your `.env`, `data/` and `media/`.
3. Run `npm ci --omit=dev`.
4. Start TakeLead again.

**Move your existing parties and songs.** On the computer you've been using, build the package with `npm run package -- --with-data`. It then includes `data/`. That folder contains host emails and password hashes, so keep the file private.

**Add your own song files.** Put them in `media/`, then click **Rescan media folder** in the host dashboard. See `media/README.md` for naming.

## Troubleshooting

| Problem | What to check |
|---|---|
| The site shows a Cloudflare 502 error | TakeLead isn't running. Check the log, or run `npm start` to see errors. |
| QR codes point to the wrong address | Set `PUBLIC_URL` in `.env` and restart. |
| Reset emails don't arrive | Look for `[mail]` lines in the log. Check the SMTP settings and the spam folder. |
| "Port 3000 is in use" | Something else is using it. Change `PORT` in `.env` and in the tunnel's public hostname. |
| Sound doesn't play on the TV | Click **Start the show** on the Now Playing screen. Browsers block sound until you click. |

## Before you go public

- **Internet provider terms.** Most home internet plans restrict running servers. A small personal site rarely causes trouble, but read your provider's acceptable use policy.
- **Cloudflare terms.** Cloudflare's free plan isn't meant for serving lots of large video files. YouTube songs don't go through your server, so they're fine. Large MP4 files in `media/` are better kept for parties on your home network.
- **Upload speed.** Song files in `media/` stream from your house to wherever the party is. Fiber handles this easily; slow DSL may stutter.
- **Who can sign up.** After creating your own account, set `ALLOW_REGISTRATION=false` unless you want others to host. The song catalog is shared by everyone who hosts on your server.

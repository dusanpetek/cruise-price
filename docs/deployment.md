# Deployment on a small VPS (Docker)

Minimum: 2 vCPU, 2 GB RAM + 2 GB swap (4 GB recommended, especially for AIDA), 20-40 GB disk, Ubuntu 24.04 or Debian 12/13, root access.

## 1. Prepare the server
```sh
curl -fsSL https://get.docker.com | sh          # Docker + compose plugin
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab  # swap keeps Chromium from being killed on 2 GB
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
```

## 2. DNS
Point an A record (e.g. `kreuzfahrt.deinedomain.de`) at the server's IPv4 address (at all-inkl: KAS > Domain > DNS settings).

## 3. Configure and start
```sh
git clone <your repo> cruise-price && cd cruise-price     # or copy the project with rsync
cp .env.example .env
pnpm --filter @cruise/api auth:setup --user dusan --totp     # on your own computer: prints the AUTH_* lines (and a random password)
nano .env                                                    # SITE_ADDRESS and the AUTH_* lines
docker compose up -d --build
```
Open `https://<your domain>`; the app shows its own login page (password, and the authenticator code when `AUTH_TOTP_SECRET` is set). HTTPS certificates come from Let's Encrypt automatically (ports 80/443 must be reachable).

## 4. Add routes and notifications
Add routes in the UI. Notification credentials go into `/data/notifications.json` inside the volume, never into the repo:
```sh
docker compose exec app sh -c 'vi /data/notifications.json'
```

## Operating
- Logs: `docker compose logs -f app`. Update: `git pull && docker compose up -d --build`.
- Collections run on the schedule (`COLLECT_CRON`); AIDA opens a headed Chromium on a virtual display (xvfb). Whether AIDA accepts a data-centre IP is only known by trying; nothing here works around bot detection.
- **Backups** (the volume is the only state):
  ```sh
  docker run --rm -v cruise-price_cruise-data:/data -v "$PWD":/out alpine tar czf /out/cruise-data-$(date +%F).tar.gz -C /data .
  ```
  Copy the archive off the server (rsync/scp), e.g. weekly via cron.
- Memory: the app container is capped at 1.5 GB RAM (+ swap). On a 4 GB server you can raise `mem_limit` in `docker-compose.yml`.
- Nothing but ports 80/443 is exposed; the API is only reachable through Caddy and asks for a signed-in session (see `deployment-strato.md`, section 9).
- Reports: the scheduler also writes the daily (07:30), weekly (Monday 08:00) and monthly (the 1st, 09:00) deal reports into the data volume (`DAILY_REPORT_CRON`, `WEEKLY_REPORT_CRON`, `MONTHLY_REPORT_CRON` in the `app` service's environment); the derived `intelligence/` folder can be left out of backups, it is rebuilt after every collection.

# syntax=docker/dockerfile:1
# Two images from one file: `app` (API + scheduler + Chromium) and `web` (Caddy with the built frontend).

# --- build the frontend ---
FROM node:22-bookworm-slim AS build
ENV COREPACK_INTEGRITY_KEYS=0
RUN corepack enable
WORKDIR /repo
COPY . .
# Contact address shown in the Impressum (baked into the static frontend).
ARG VITE_LEGAL_EMAIL=
ENV VITE_LEGAL_EMAIL=$VITE_LEGAL_EMAIL
RUN pnpm install --frozen-lockfile && pnpm build

# --- app: API, scheduler and collectors. The Playwright image brings Chromium and its system libraries. ---
FROM mcr.microsoft.com/playwright:v1.65.1-noble AS app
ENV NODE_ENV=production CRUISE_DATA_DIR=/data ENABLE_SCHEDULER=1 CRUISE_LANGUAGE=de
RUN npm install -g pnpm@9.15.4 && apt-get update && apt-get install -y --no-install-recommends xvfb && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY . .
# tsx runs the TypeScript sources, so dev dependencies stay installed.
RUN NODE_ENV=development pnpm install --frozen-lockfile
VOLUME /data
EXPOSE 8787
# xvfb-run gives the headed browser (AIDA) a virtual display on a server without a monitor.
CMD ["xvfb-run", "-a", "--server-args=-screen 0 1280x900x24", "pnpm", "--filter", "@cruise/api", "start"]

# --- web: static frontend, /api goes to the app (which does the sign-in) ---
FROM caddy:2 AS web
COPY --from=build /repo/apps/frontend/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile

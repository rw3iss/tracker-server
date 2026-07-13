---
title: Deployment
description: How tracker-server ships to production, plus running locally end-to-end.
sidebar:
  order: 3
---

## Local

The full pipeline runs locally with Docker for Postgres and Redis, plus
two long-running processes (Go ingest, Node consumer).

```bash
# 1. Start the stateful side
docker run -d --name tracker-pg    -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16
docker run -d --name tracker-redis -p 6379:6379 redis:7

# Tracker-events table needs uuid-ossp if you didn't enable on cluster.
PGPASSWORD=postgres psql -h localhost -U postgres -d tracker \
  -c 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'

# 2. Run tracker-server
cd tracker-server
pnpm install
pnpm build
pnpm dev   # PORT=4010, watches ./src

# 3. (Optional) Run tracker-ingest in another shell
cd ../tracker-ingest
go run ./cmd/tracker-ingest    # PORT=4011

# 4. Send a test event
curl -X POST http://localhost:4010/api/events \
  -H 'Content-Type: application/json' \
  -d '{"type":"info","message":"hello","timestamp":'"$(date +%s%3N)"'}'

# 5. Open the dashboard
open http://localhost:4010/dashboard

# 6. Open the docs (this site)
open http://localhost:4010/docs
```

## Production — the deploy host EC2

The deploy is one GitHub Actions workflow that SSHes to the deploy host
(`<deploy-host-ip>`), pulls `production`, installs, builds, restarts pm2.

**File:** `tracker-server/.github/workflows/deploy.yml`.

**Trigger:** push to the `production` branch.

**Steps:**

1. Pull the production branch into `~/apps/tracker-server`.
2. Write `.npmrc` for GitHub Packages (`@rw3iss` scope).
3. `pnpm install --frozen-lockfile` (falls back to `pnpm install` for
   lockfile drift).
4. `pnpm build` — compiles the Nest app via SWC.
5. `pnpm docs:build` — produces the static docs bundle in `docs/dist/`.
   Skipped if you keep `DOCS_ENABLED=false`.
6. Write `.env` from GitHub secrets.
7. `pm2 delete tracker-server || true && pm2 start dist/main.js`.
8. `pm2 save` so it restarts on host reboot.

**To deploy:**

```bash
# On a maintainer's machine:
git checkout production
git merge --ff-only main
git push origin production
# Watch the deploy:
gh run watch --workflow deploy.yml
```

**Rollback:**

```bash
git checkout production
git revert HEAD       # or reset to the prior known-good SHA
git push origin production
```

## Process layout on the deploy host

- pm2 process `tracker-server` — Node consumer + dashboard + docs.
  Listens on `127.0.0.1:4010`, fronted by nginx.
- pm2 process `tracker-ingest` — Go ingest.
  Listens on `127.0.0.1:4011`, fronted by nginx.
- Docker container `tracker-redis` — Redis for the LIST + dedup cache.
  `127.0.0.1:6380`.
- Docker container `tracker-tsdb` — TimescaleDB.
  `127.0.0.1:5436`.

nginx routes `tracker.ryanweiss.net/ingest/*` → ingest, everything else
(`/api/*`, `/dashboard`, `/docs`) → tracker-server.

## Health checks

| URL                                    | Expected               |
|----------------------------------------|------------------------|
| `https://tracker.ryanweiss.net/api/metrics` | Prometheus text exposition |
| `https://tracker.ryanweiss.net/dashboard`   | HTML (200)            |
| `https://tracker.ryanweiss.net/docs`        | HTML (200) when DOCS_ENABLED=true |
| `https://tracker.ryanweiss.net/api/events?limit=1` | JSON array       |

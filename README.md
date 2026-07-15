# @rw3iss/tracker-server

<!-- Static badge: this repo is private, so shields.io's auto-fetch
     endpoint can't read its release list. Update the version segment
     below at each `git tag` + `gh release create`. -->
[![Latest release](https://img.shields.io/badge/release-v1.0.0-blue)](https://github.com/rw3iss/tracker-server/releases)

NestJS deployment package for the rw3iss tracker platform — drains the
Go ingest server's Redis LIST into Postgres, exposes the HTTP API, serves
the self-hosted dashboard at `/dashboard`, and serves the Astro Starlight
docs site at `/docs`.

## Documentation

The platform docs live in this repo under `docs/` and ship as a static
Starlight bundle that this server hosts at `/docs`.

- 📖 **[tracker.ryanweiss.net/docs](https://tracker.ryanweiss.net/docs/)** — production docs site
- 📜 **[HTTP API contract](https://tracker.ryanweiss.net/docs/api/contract/)** — wire format every emitter speaks
- 🧱 **[Architecture](https://tracker.ryanweiss.net/docs/concepts/architecture/)** — how the pieces connect
- ⚙️ **[Operations](https://tracker.ryanweiss.net/docs/operations/config/)** — env vars, deploy, dashboard

### SDKs

| Language    | Repo                                                                  |
|-------------|-----------------------------------------------------------------------|
| TypeScript  | [rw3iss/tracker](https://github.com/rw3iss/tracker)                 |
| Go          | [rw3iss/tracker-go](https://github.com/rw3iss/tracker-go)           |
| PHP         | [rw3iss/tracker-php](https://github.com/rw3iss/tracker-php)         |
| Go ingest   | [rw3iss/tracker-ingest](https://github.com/rw3iss/tracker-ingest)   |

## Building & running the docs

The docs are an Astro Starlight project under `docs/`. They ship as a
static bundle that tracker-server serves conditionally.

```bash
# One-time
npm run docs:install

# Live edit while writing content (separate dev server, hot reload)
npm run docs:dev      # http://localhost:4321

# Produce the static bundle that the running server serves
npm run docs:build    # writes ./docs/dist

# Run the API + serve the docs in one process
npm run build:all     # build the API and the docs together
npm start         # docs available at http://localhost:4010/docs
```

Toggle docs on/off and change the mount path:

```sh
DOCS_ENABLED=true        # default
DOCS_PATH=docs           # default — change to mount elsewhere
```

When `DOCS_ENABLED=false`, the controller isn't registered at all; the
docs route returns 404 like any unknown path.

## Architecture

```
                       tracker.ryanweiss.net
                              │
                            Nginx
                         ┌────┴────┐
                    /ingest/*    /api/* + /dashboard
                         │         │
                  Go :4011    NestJS :4010  ← this repo
                  (5MB RAM)   (120MB RAM)
                         │         │
                  LPUSH  │   RPOP  │
                         │         │
                    Redis LIST     │
                 "tracker:ingest"  │
                                   │
                            ┌──────┴──────┐
                            │ TimescaleDB │
                            │  (hypertable │
                            │  1-day chunks│
                            │  compression)│
                            └─────────────┘
```

**This server handles:** Dashboard UI, event queries, SSE stream, Prometheus metrics, Redis consumer, TimescaleDB writes.

**The [Go ingest server](https://github.com/rw3iss/tracker-ingest) handles:** High-throughput HTTP event ingestion, API key validation, Redis LPUSH.

### TimescaleDB

The tracker uses TimescaleDB (a Postgres extension) for time-series optimized storage:

- **Hypertable** partitioned by `receivedAt` with 1-day chunks
- **Auto-compression** on chunks older than 7 days (90%+ storage reduction)
- **Compression segmentby** `appId` + `type` for efficient compressed queries
- All standard Postgres queries work — it IS Postgres
- Auto-detected: if TimescaleDB extension is available, `ensureTrackerTable()` creates a hypertable. Otherwise, a standard table.

## Quick Start

```bash
npm install
cp .env.example .env   # edit with real values
npm run dev               # development (direct writes, no queue)
```

## Production

```bash
npm run build             # SWC build (~200ms)
npm start:prod        # or use PM2:
pm2 start pm2.config.js
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DB_HOST` | `localhost` | Postgres host |
| `DB_PORT` | `5432` | Postgres port |
| `DB_USER` | `postgres` | Postgres user |
| `DB_PASS` | `postgres` | Postgres password |
| `DB_NAME` | `tracker` | Database name |
| `DB_SSL` | `true` (in production) | Set `false` for local Postgres |
| `REDIS_URL` | `redis://localhost:6379` | Redis for BullMQ queue |
| `PORT` | `4010` | HTTP listen port |
| `NODE_ENV` | `development` | Environment |
| `USE_QUEUE` | `true` | BullMQ async writes (`false` = direct INSERT) |
| `TRACKER_TABLE_NAME` | `tracker_events` | Custom table name |
| `TRACKER_API_KEYS` | *(none)* | Comma-separated API keys (see below) |
| `ENABLE_INGEST_CONSUMER` | `true` | Consume events from Go ingest Redis LIST |
| `REDIS_LIST_KEY` | `tracker:ingest` | Redis LIST key for Go ingest consumer |
| `DASHBOARD_ENABLED` | `true` | `false` to omit the dashboard controller (route → 404) |
| `DASHBOARD_PATH` | `dashboard` | Mount path for the dashboard UI |
| `TRACKER_DASHBOARD_UPDATE_MODE` | `modal` | Auto-update behaviour when a new build loads — `modal` (wipe stale storage + show the changelog modal), `auto` (wipe silently), or `false` (skip the version check). The header "Changes" button works in all modes. |

## API Key Authentication

Optional. When set, server-to-server clients must send `X-Tracker-Key` header. Browser clients (no header) are still allowed.

### Single key

```bash
# Generate a key
openssl rand -hex 32

# .env
TRACKER_API_KEYS=a1b2c3d4e5f6...
```

### Multiple keys (one per client)

Each client gets its own key. Revoking one doesn't affect others.

```bash
# Generate one per client
openssl rand -hex 32   # → for api-server
openssl rand -hex 32   # → for go-service
openssl rand -hex 32   # → for php-app

# .env (comma-separated)
TRACKER_API_KEYS=key-for-api-server,key-for-go-service,key-for-php-app
```

Keys are SHA-256 hashed at startup — raw values are never stored in memory. Lookup is O(1) per request via a hashed Set.

### Client configuration

Each client sets its key in its own config:

**TypeScript:**
```typescript
TrackerClient.init({
  endpoint: 'https://tracker.ryanweiss.net/ingest/events',
  apiKey: process.env.TRACKER_API_KEY,
});
```

**Go:**
```go
tracker.Init(tracker.Config{
    Endpoint: "https://tracker.ryanweiss.net/ingest/events",
    APIKey:   os.Getenv("TRACKER_API_KEY"),
})
```

**PHP:**
```php
TrackerClient::init([
    'endpoint' => 'https://tracker.ryanweiss.net/ingest/events',
    'apiKey'   => getenv('TRACKER_API_KEY'),
]);
```

### Validation rules

| Scenario | Result |
|---|---|
| Header present + valid key | Allowed |
| Header present + invalid key | `403 Forbidden` |
| Header absent + keys configured | Allowed (browser clients) |
| No keys configured | All requests allowed |

### Revoking a key

Remove the key from `TRACKER_API_KEYS` and restart the server. The revoked client gets `403`, all others continue working.

## Endpoints

API prefix is configurable via `ROUTE_PREFIX` (default `api`). The dashboard path is configurable via `DASHBOARD_PATH` (default `dashboard`) and is **independent of the API prefix** — it's a UI surface, not an API endpoint.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/events` | Ingest events (single or batch) |
| `GET` | `/api/events` | Query stored events |
| `GET` | `/api/events/stream` | SSE live event stream |
| `PATCH` | `/api/events/:id/status` | Update event status |
| `GET` | `/api/metrics` | Prometheus metrics |
| `GET` | `/dashboard` | Event dashboard UI (UI, not API — not under `/api`) |

Example with custom prefix — `ROUTE_PREFIX=monitoring DASHBOARD_PATH=ui` → API at `/monitoring/*`, UI at `/ui`.

## Deployment

Deploys via GitHub Actions on push to `production` branch.

Required GitHub secrets:
- `DEPLOY_HOST` — EC2 IP
- `DEPLOY_SSH_KEY` — SSH private key
- `GH_PACKAGES_TOKEN` — GitHub PAT with `packages:read`
- `TRACKER_DB_HOST`, `TRACKER_DB_PORT`, `TRACKER_DB_USER`, `TRACKER_DB_PASS`, `TRACKER_DB_NAME`
- `TRACKER_REDIS_URL`
- `TRACKER_API_KEYS` — comma-separated API keys

## Hosted at

`https://tracker.ryanweiss.net`

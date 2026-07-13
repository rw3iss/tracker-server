---
title: Configuration
description: Every env var tracker-server reads, what it does, and the default.
sidebar:
  order: 1
---

`tracker-server` is configured entirely by env vars at boot — no config
file, no runtime control plane. Set them in `.env`, in the deploy
workflow, or pass them inline. Defaults are designed to be production-
sane.

The tables below list every env var the server actually reads. For a
flat alphabetical lookup, see the
[env-var quick reference](/docs/reference/env-vars/).

## Required

| Variable        | What it does                                                  |
|-----------------|---------------------------------------------------------------|
| `DB_HOST`       | Postgres host.                                                |
| `DB_PORT`       | Postgres port (typically 5432, prod is 5436).                 |
| `DB_USER`       | Postgres user with INSERT + SELECT on `tracker_events`.       |
| `DB_PASS`       | Postgres password.                                            |
| `DB_NAME`       | Database name (typically `tracker`).                          |
| `REDIS_URL`     | Full Redis URL — `redis://host:port` or `rediss://…` for TLS. |

## Connection

| Variable    | Default | What it does                                                |
|-------------|---------|-------------------------------------------------------------|
| `DB_SSL`    | `false` (`true` in `NODE_ENV=production`) | Connect to Postgres over TLS. |
| `NODE_ENV`  | `development` | `production` enables Node optimizations + production-mode SSL. |

## Routing

| Variable             | Default     | What it does                                       |
|----------------------|-------------|----------------------------------------------------|
| `PORT`               | `4010`      | HTTP listen port.                                  |
| `ROUTE_PREFIX`       | `api`       | Prefix for all API routes — `/api/events`, `/api/metrics`, … |
| `DASHBOARD_ENABLED`  | `true`      | Set `false` to omit the dashboard controller. The route returns 404 like any unknown path. |
| `DASHBOARD_PATH`     | `dashboard` | Mount path for the dashboard UI (e.g. `/dashboard`). |
| `TRACKER_DASHBOARD_UPDATE_MODE` | `modal` | Auto-update behaviour when the dashboard detects a new build. See [Dashboard auto-update](#dashboard-auto-update) below. |
| `DOCS_ENABLED`       | `true`      | Set `false` to omit this docs site at runtime.    |
| `DOCS_PATH`          | `docs`      | Mount path for the docs site (e.g. `/docs`).      |

## Storage / queue

| Variable                  | Default          | What it does                                            |
|---------------------------|------------------|---------------------------------------------------------|
| `USE_QUEUE`               | `true`           | `true` → use BullMQ-backed batch INSERTs (production); `false` → INSERT inline. |
| `ENABLE_INGEST_CONSUMER`  | `true`           | Drain the Redis LIST that `tracker-ingest` writes to.   |
| `REDIS_LIST_KEY`          | `tracker:ingest` | Name of the Redis LIST.                                 |

## Ingest auth

| Variable             | Default       | What it does                                                  |
|----------------------|---------------|---------------------------------------------------------------|
| `TRACKER_API_KEYS`   | (none)        | API keys (SHA-256 hashed at boot into an O(1) Set). Comma-, newline-, or whitespace-separated; `#`-prefixed lines are treated as comments. **Setting any key takes ingestion out of public mode** — every POST then needs a matching `X-Tracker-Key` header (a missing header returns `403`). |

The same env var is also read by the Go [`tracker-ingest`](https://github.com/rw3iss/tracker-ingest) frontend so the two ingest paths stay symmetric. Multi-line annotated form:

```sh
TRACKER_API_KEYS="
# auction api-server (dev / stg / prod)
cae67a48...
# colleague-app
e5000dc6...
"
```

## Admin auth

| Variable             | Default       | What it does                                                                  |
|----------------------|---------------|-------------------------------------------------------------------------------|
| `TRACKER_ADMIN_KEY`  | (none)        | Shared secret for `POST /api/admin/clear-events`. Without it the admin route isn't registered (404). See [Admin operations](/docs/operations/admin/). |

## Observability

| Variable                  | Default     | What it does                                                |
|---------------------------|-------------|-------------------------------------------------------------|
| `DISTINCT_CACHE_TTL_MS`   | `60000`     | TTL for `GET /api/events/distinct` results. `0` disables the cache. |

## Dashboard auto-update

Each build of `tracker-server` stamps `dist/dashboard/js/version.js` with a
`<short-sha>-<unix-ms>` version + the last 80 commits. When a browser
loads a build whose version differs from the one stored in its
`localStorage`, the dashboard's auto-update routine clears stale prefs
(filters, columns, theme, panel sizes) and re-stamps the version. By
default it then opens a "Dashboard updated" modal showing what changed
since the last visit, with linked commit hashes.

Operators control whether (and how) the routine fires via
`TRACKER_DASHBOARD_UPDATE_MODE`:

| Value     | What happens on new build | Manual "Changes" button |
|-----------|---------------------------|-------------------------|
| `modal` *(default)* | Wipe stale storage · re-stamp version · show the changelog modal — user clicks OK to reload. | works (view-only) |
| `auto`    | Wipe stale storage · re-stamp version, **silently**. No modal. The reload happens on the next interaction-driven refresh. | works (view-only) |
| `false`   | Skip the version check entirely. Storage is left alone. | works (view-only) |

The header "Changes" button is independent of this mode — it always
opens the changelog modal in view-only mode (no wipe, no reload),
regardless of the configured value, so users can review what's running
even on a `false`-mode deployment.

The env var is also forgiving on input: `true` / `1` / `yes` /
`on` / `silent` are accepted as synonyms for `auto`; `0` / `no` /
`off` / `disabled` for `false`. Anything unrecognized falls back to
`modal`.

```sh
# Three valid configurations
TRACKER_DASHBOARD_UPDATE_MODE=modal     # default — show the changelog
TRACKER_DASHBOARD_UPDATE_MODE=auto      # silent reset
TRACKER_DASHBOARD_UPDATE_MODE=false     # no auto-update at all
```

## Deduplication

Configured in code on `TrackerModule.register({ deduplication: { … } })`.
Defaults: enabled, 5-minute window, **per-user** scope.

The fingerprint is what decides two events are "the same". By default
it includes:

```
appId · type · message · error.name · error.message · context.userId · context.environment
```

So two different users hitting the same error are reported separately
(they don't dedupe each other), but the same user repeatedly throwing
the same error within five minutes only shows up once.

### Picking a different scope

The four built-in scopes cover the common cases:

| Scope                | What's in the fingerprint                                         | When you want this                            |
|----------------------|--------------------------------------------------------------------|-----------------------------------------------|
| `'perUser'`          | …userId, environment (default)                                     | "Each user reports their own errors"          |
| `'perSession'`       | …userId, sessionId, environment                                    | Same user's two browser tabs are independent  |
| `'perUserAndSession'`| alias of `perSession`                                              | Same as above, more explicit name             |
| `'global'`           | …no userId — every user dedupes against everyone                   | Noisy upstream-failure class — "tell me once" |

```typescript
TrackerModule.register({
    deduplication: {
        enabled: true,
        windowMs: 5 * 60_000,
        scope: 'perSession',     // ← override the default
    },
});
```

### Custom fingerprint composition

Pass `fields` for a fully custom field list (each entry is a top-level
event property name, a dotted path, or a function returning a string):

```typescript
TrackerModule.register({
    deduplication: {
        enabled: true,
        fields: ['type', 'payload.orderId'],   // dedup by order, ignore everything else
    },
});
```

Or pass `fingerprint` for an arbitrary function:

```typescript
TrackerModule.register({
    deduplication: {
        enabled: true,
        fingerprint: (e) => `${e.type}:${e.payload?.orderId ?? ''}`,
    },
});
```

When multiple are set, `fingerprint` wins, then `fields`, then `scope`,
then the default.

### Bypassing dedup for intentional repeated events

Dedup is for noisy errors. **Lifecycle markers** (`bid.place_started`,
`bid.place_committed`, `auction.started`, `order.paid`, …) and
**analytics events** are usually intentional — two firings from the
same user inside the dedup window are signal, not noise, and should
both land. There are three layers of opt-out, ordered by who knows
the most:

| Layer | Where it lives | Use case |
|---|---|---|
| **1. Per-event wire flag** | `event.dedup === false` on the captured event | "this *one specific* event needs to land twice" |
| **2. Emitter init policy** | `TrackerClient.init({ dedup: { bypassMessages, bypassPredicate } })` | "this app's `bid.*` events legitimately repeat" |
| **3. Server-side predicate** | `TrackerModule.register({ deduplication: { bypassDedup } })` | Cross-app rules + emergency overrides |

**Layers 1 & 2 are the primary opt-outs** — the producing app knows
its event domain best, so dedup decisions live in the emitter:

```typescript
// In each app's TrackerClient.init({...}):
TrackerClient.init({
    endpoint: 'https://tracker.ryanweiss.net/ingest/events',
    appId:    'api-server',
    dedup: {
        // Stamps `event.dedup = false` on every captured event whose
        // message starts with one of these prefixes (or equals it).
        bypassMessages: ['bid.', 'auction.', 'order.'],
        // Or supply a predicate alongside (composes with OR).
        bypassPredicate: (e) => e.type === 'event',
    },
});
```

Per-event override at the call site wins over the init policy:

```typescript
// Even though "bid." matches, this one event opts back into dedup.
tracker.capture({
    type:    'event',
    message: 'bid.place_committed',
    dedup:   true,    // explicit override
});
```

**Layer 3 — server-side `bypassDedup`** — is the catch-all for rules
that should hold regardless of whether emitters remember to set their
own policy. Cross-app rules live here. The predicate runs **before**
the fingerprint is computed; returning `true` skips dedup entirely
(no cache read or write):

```typescript
TrackerModule.register({
    deduplication: {
        enabled: true,
        windowMs: 300_000,
        bypassDedup: (e) => e.type === 'event',  // analytics — never noise
    },
});
```

Resolution order in the consumer's deduplicator:

1. `event.dedup === false` → skip dedup (highest priority — explicit emitter signal).
2. Server `bypassDedup(event)` → skip dedup.
3. Otherwise: fingerprint and check the cache.

> Per-event wire flag and emitter init policy: since `@rw3iss/tracker`
> v0.3.0 / `tracker-go` da1974a / `tracker-php` eb25bda. Server-side
> `bypassDedup` predicate: since v0.2.0.

### Disabling

```typescript
TrackerModule.register({
    deduplication: { enabled: false },
});
```

Or set `windowMs: 0` if you want the configuration in place but
short-circuited.

## Putting it together

A minimal `.env` for local dev:

```sh
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASS=postgres
DB_NAME=tracker
REDIS_URL=redis://localhost:6379

PORT=4010
ROUTE_PREFIX=api
DASHBOARD_PATH=dashboard
DOCS_PATH=docs

# Disable the queue + ingest consumer for the simplest single-process setup.
USE_QUEUE=false
ENABLE_INGEST_CONSUMER=false

# Disable surfaces if you only want the API.
# DASHBOARD_ENABLED=false
# DOCS_ENABLED=false
```

A production `.env`:

```sh
DB_HOST=postgres-prod.internal
DB_PORT=5436
DB_USER=tracker
DB_PASS=...
DB_NAME=tracker
DB_SSL=true
REDIS_URL=rediss://redis-prod.internal:6380

PORT=4010
ROUTE_PREFIX=api
DASHBOARD_PATH=dashboard
DOCS_PATH=docs

USE_QUEUE=true
ENABLE_INGEST_CONSUMER=true

TRACKER_API_KEYS=key-for-buyer,key-for-seller,key-for-go-services

DISTINCT_CACHE_TTL_MS=60000
```

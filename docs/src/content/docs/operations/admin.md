---
title: Admin operations
description: Clearing events from the dashboard, the CLI, or the HTTP admin endpoint.
sidebar:
  order: 5
---

Operations that mutate stored events sit on a separate authentication
surface from ingest. Two ways to invoke them today:

1. The **CLI** — for ops people with shell access to the box.
2. The **HTTP admin endpoint** — for scripted automation, or the
   future dashboard "wipe" button (admin role-gated).

Both call the same `TrackerService.clearEvents(filters)` so behaviour
stays consistent across surfaces.

## Configure

```sh
# tracker-server/.env
TRACKER_ADMIN_KEY=$(openssl rand -hex 32)
```

Without an admin key:

- The HTTP route `POST /api/admin/clear-events` returns 404 (controller
  isn't even mounted — fail closed).
- The CLI still works locally — shell access on the box is the auth.

The admin key is intentionally separate from the ingest API keys
(`TRACKER_API_KEYS`). Admin operations have a different threat model
and shouldn't share secrets with read/write traffic.

## CLI — shell access on the box

```bash
# Dry-run: count what would be deleted (does not delete)
npm run tracker:clear-events -- --app-id dev-alt-rw3iss --dry-run

# Targeted: delete events from one app
npm run tracker:clear-events -- --app-id dev-alt-rw3iss

# Multi-app
npm run tracker:clear-events -- --app-ids web,api,auth

# Time-bounded: drop debug events older than a week
npm run tracker:clear-events -- --type debug \
    --before "$(date -d '1 week ago' +%s%3N)"

# Full wipe (requires explicit --all)
npm run tracker:clear-events -- --all
```

Available filters: `--app-id`, `--app-ids`, `--type`, `--status`,
`--category`, `--user-id`, `--environment`, `--since`, `--before`.
Multiple filters are AND-combined. See `--help` for the full list.

The CLI guards against accidental full wipes — running with no filter
and no `--all` flag exits with a usage error rather than running
`TRUNCATE`.

## HTTP — `POST /api/admin/clear-events`

```bash
curl -X POST https://tracker.ryanweiss.net/api/admin/clear-events \
  -H "Content-Type: application/json" \
  -H "X-Tracker-Admin-Key: $TRACKER_ADMIN_KEY" \
  -d '{ "appId": "dev-alt-rw3iss", "type": "debug" }'
# → { "ok": true, "deleted": 142 }
```

Body fields (all optional, AND-matched):

| Field          | Notes                                                   |
|----------------|---------------------------------------------------------|
| `appId`        | Single appId, exact match.                              |
| `appIds`       | Array of appIds, OR-matched.                            |
| `type`         | `error \| warning \| info \| debug \| event`.           |
| `status`       | Lifecycle status — `new \| viewed \| …`.                |
| `category`     | Exact match.                                            |
| `userId`       | `context.userId` exact.                                 |
| `environment`  | `context.environment` exact.                            |
| `from`         | Unix ms — only events with `receivedAt >= from`.        |
| `to`           | Unix ms — only events with `receivedAt <= to`.          |
| `confirm`      | `true` required when no other filter narrows the delete. |

### Full wipe

A POST with an empty body or no narrowing filter is rejected with
`400` unless `confirm: true` is included:

```bash
curl -X POST https://tracker.ryanweiss.net/api/admin/clear-events \
  -H "X-Tracker-Admin-Key: $TRACKER_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "confirm": true }'
```

### Auth failures

| Header / key state              | Status |
|---------------------------------|--------|
| Header missing                  | 403    |
| Header present, key mismatch    | 403    |
| `TRACKER_ADMIN_KEY` not set     | 404    |

The 404 case skips controller registration entirely — there's no
oracle for "admin auth is on but you don't have it".

## Programmatic use

The same path is on `TrackerService` for any code that wants in:

```typescript
import { TrackerService } from '@rw3iss/tracker/consumer';

const deleted = await trackerService.clearEvents({
    appId: 'auction-api-dev',
    from:  Date.now() - 86_400_000,    // last 24h
});
```

When the admin role lands on the dashboard, the "wipe" button hits
the existing `/api/admin/clear-events` endpoint — no new code needed.

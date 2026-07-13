---
title: Query & SSE
description: GET /api/events, the live SSE stream, and PATCH for status updates.
sidebar:
  order: 3
---

Reads happen against the consumer's query API. The dashboard uses these
endpoints; you can hit them from your own tooling (CI scripts,
dashboards in other tools, alerting glue) the same way.

## GET /api/events — query

```http
GET /api/events?type=error&appId=api-server&limit=50
```

Returns the matching events as a JSON array, ordered newest-first by
default.

### Filters

| Param                   | Behaviour                                              |
|-------------------------|--------------------------------------------------------|
| `appId`                 | **Substring**, case-insensitive. `?appId=dev` → matches `dev-portal`, `dev-server`, … |
| `appIds`                | **Exact list**, comma-separated. `?appIds=web,auth,api`. |
| `category`              | Substring, case-insensitive.                           |
| `userId`                | Substring on `context.userId`.                         |
| `environment`           | Substring on `context.environment`.                    |
| `type`                  | Exact: `error \| warning \| info \| debug \| event`.   |
| `status`                | Exact: `new \| viewed \| acknowledged \| in_progress \| resolved \| wont_fix \| archived`. |
| `from`                  | Unix ms (inclusive). Filters by `receivedAt`.          |
| `to`                    | Unix ms (inclusive).                                   |
| `payload.<key>`         | JSONB containment match — `?payload.orderId=12345`.    |
| `limit`                 | 1–1000, default 100.                                   |
| `offset`                | Default 0 — page through results.                      |
| `sortBy`                | `id \| type \| message \| appId \| category \| status \| timestamp \| receivedAt`. |
| `sortDir`               | `asc \| desc` — default `desc`.                        |

Multiple filters are AND-combined. Substring fields use `ILIKE %val%`
under the hood; exact-list fields use `IN (…)`.

### Example

```bash
# All errors from the api-server in the last hour, with payload.orderId set
curl -s "https://tracker.ryanweiss.net/api/events?\
type=error&\
appId=api-server&\
from=$(date -d '1 hour ago' +%s%3N)&\
limit=200" | jq '.[] | { id, message, payload }'
```

## GET /api/events/distinct — value picker

Returns distinct values + counts for one allow-listed column. Backs the
dashboard's app-picker dropdown; reusable for any "show me the choices"
UI.

```http
GET /api/events/distinct?field=appId
```

Response:

```json
[
  { "value": "api-server",      "count": 1234 },
  { "value": "buyer-portal",    "count": 987  },
  { "value": "auction-api-dev", "count": 142  }
]
```

| Param   | Notes |
|---------|-------|
| `field` | Required. One of `appId \| category \| type \| status \| environment`. |
| `limit` | 1–2000, default 500.                                            |

Cached in process for `distinctCacheTtlMs` (configurable on
tracker-server, default 60s — see
[Operations → Configuration](/docs/operations/config/#docs--observability)).

## SSE — live stream

```http
GET /api/events/stream?type=error
```

A long-lived `text/event-stream` connection. The server polls Postgres
every 2 seconds for new events matching the filters; matches are pushed
as `data: {…}\n\n` frames. Idle ticks send a `: keepalive\n\n` comment so
proxies don't time out the connection.

```ts
const src = new EventSource(
  'https://tracker.ryanweiss.net/api/events/stream?type=error',
);
src.onmessage = (e) => console.log('new event', JSON.parse(e.data));
```

The dashboard uses this and falls back to polling `GET /api/events`
every 5s if SSE fails to open within 5s.

## PATCH /api/events/:id/status — update lifecycle

```http
PATCH /api/events/c4f9a... /status
Content-Type: application/json

{ "status": "resolved" }
```

Response: `200 OK`, body `{ "ok": true }`.

Used by the dashboard's detail panel — close-the-loop on triage. See
[Concepts → Events](/docs/concepts/events/#status-lifecycle) for what each
status means.

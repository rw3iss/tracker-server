---
title: Distinct values
description: GET /api/events/distinct — backs the dashboard's app picker, useful for any "show me the choices" UI.
sidebar:
  order: 4
---

```http
GET /api/events/distinct?field=appId
```

Returns the distinct values for a single allow-listed column, ordered
by event count (descending), with their counts.

```json
[
  { "value": "api-server",      "count": 1234 },
  { "value": "buyer-portal",    "count": 987  },
  { "value": "auction-api-dev", "count": 142  }
]
```

## Parameters

| Param   | Required | Notes                                                              |
|---------|----------|--------------------------------------------------------------------|
| `field` | yes      | One of `appId \| category \| type \| status \| environment`. Anything else returns `400`. |
| `limit` | no       | 1–2000, default 500.                                               |

The field allow-list is enforced at the controller level — there's no
SQL-injection vector. Adding a new field means editing the registry in
`ITrackerStorage.ts`.

## Caching

Results are cached in process for `DISTINCT_CACHE_TTL_MS` (default
60s, set to `0` to disable). The cache is keyed by `(field, limit)`.

The single-process cache is intentional — the set is small (one entry
per allow-listed field), recomputable cheaply, and the TTL window is
short. Redis would add coordination cost for no measurable upside.

## Why it exists

Free-text app-id search worked fine when there were 3 apps. With more
than ~10, autocomplete + multi-select is required for a usable
dashboard. The endpoint exists so the dashboard doesn't have to ship
the list of known apps in the static bundle.

The same shape generalises to other dropdowns (category, environment,
…) as the dashboard grows.

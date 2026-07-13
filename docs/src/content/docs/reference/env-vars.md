---
title: Env-var quick reference
description: Every env var tracker-server reads, in one table you can grep.
sidebar:
  order: 1
---

A flat alphabetical list — for the grouped rationale, see
[Operations → Configuration](/docs/operations/config/).

| Variable                  | Default          | Notes                                              |
|---------------------------|------------------|----------------------------------------------------|
| `DASHBOARD_ENABLED`       | `true`           | Set `false` to drop the dashboard controller.      |
| `DASHBOARD_PATH`          | `dashboard`      | Mount path for the dashboard UI.                   |
| `DB_HOST`                 | (required)       | Postgres host.                                     |
| `DB_NAME`                 | (required)       | Postgres database (typically `tracker`).           |
| `DB_PASS`                 | (required)       | Postgres password.                                 |
| `DB_PORT`                 | (required)       | Postgres port.                                     |
| `DB_SSL`                  | `false`          | `true` to require TLS to Postgres.                 |
| `DB_USER`                 | (required)       | Postgres user.                                     |
| `DISTINCT_CACHE_TTL_MS`   | `60000`          | TTL for `/api/events/distinct`. `0` disables.      |
| `DOCS_ENABLED`            | `true`           | Set `false` to drop the docs controller.           |
| `DOCS_PATH`               | `docs`           | Mount path for the docs site.                      |
| `ENABLE_INGEST_CONSUMER`  | `true`           | Drain the Redis LIST written by `tracker-ingest`.  |
| `NODE_ENV`                | `development`    | `production` enables NODE optimisations.           |
| `PORT`                    | `4010`           | HTTP listen port.                                  |
| `REDIS_LIST_KEY`          | `tracker:ingest` | Redis LIST consumed for ingestion.                 |
| `REDIS_URL`               | (required)       | Full Redis URL.                                    |
| `ROUTE_PREFIX`            | `api`            | Prefix for tracker API routes.                     |
| `TRACKER_ADMIN_KEY`       | (none)           | Shared secret for `POST /api/admin/clear-events`. Without it, admin routes return 404. |
| `TRACKER_API_KEYS`        | (none)           | API keys for `X-Tracker-Key` auth. Comma-, newline-, or whitespace-separated; `#`-prefixed lines ignored. **Any value disables public ingestion** — see [API contract → Authentication](/docs/api/contract/#authentication). |
| `USE_QUEUE`               | `true`           | BullMQ-backed batching of INSERTs.                 |

---
title: Architecture
description: How the tracker pieces fit together — emitter, ingest, queue, consumer, storage, dashboard.
sidebar:
  order: 1
---

The tracker platform is five small services that hand events from end-user
apps through to a queryable Postgres store, with a self-hosted dashboard on
top. Each piece has one job and one wire format between it and the next.

## System overview

```mermaid
flowchart TB
    subgraph Clients[" Apps (browsers · Node · Go · PHP) "]
        BP["@rw3iss/tracker"]
        GO["tracker-go"]
        PHP["tracker-php"]
    end

    Ingest["tracker-ingest (Go)<br/>validates · LPUSHes<br/>~5 MB RAM"]
    Redis[("Redis<br/>LIST tracker:ingest")]
    Pipe["tracker-server (Nest)<br/>Enrich → onIngest →<br/>Dedup → Stamp → onEvent"]
    Postgres[(Postgres)]
    Dashboard["/dashboard"]
    API["/api/*"]
    Docs["/docs (this site)"]

    BP  -->|HTTPS<br/>/ingest/events| Ingest
    GO  -->|HTTPS| Ingest
    PHP -->|HTTPS| Ingest
    Ingest -->|LPUSH| Redis
    Redis  -->|RPOP 100 / 500 ms| Pipe
    Pipe --> Postgres
    Pipe --> Dashboard
    Pipe --> API
    Pipe --> Docs

    classDef client fill:#312e81,stroke:#6366f1,color:#e0e7ff,stroke-width:2px
    classDef go     fill:#064e3b,stroke:#10b981,color:#d1fae5,stroke-width:2px
    classDef redis  fill:#7f1d1d,stroke:#ef4444,color:#fecaca,stroke-width:2px
    classDef nest   fill:#78350f,stroke:#f59e0b,color:#fef3c7,stroke-width:2px
    classDef db     fill:#3b0764,stroke:#a855f7,color:#f3e8ff,stroke-width:2px
    classDef ui     fill:#14532d,stroke:#22c55e,color:#dcfce7,stroke-width:2px

    class BP,GO,PHP client
    class Ingest go
    class Redis redis
    class Pipe nest
    class Postgres db
    class Dashboard,API,Docs ui
```

## Event lifecycle

A single event passes through six steps. Steps 1–2 happen client-side; 3–6
happen server-side and are observable in the dashboard.

1. **Capture** — `tracker.error(...)` / `.info(...)` / etc. Runs the local
   pipeline (severity filter → rate limit → enrichers → plugin
   `onCapture` → `beforeSend` → queue).
2. **Batch flush** — the in-memory queue ships every 5 seconds (or when
   batch size hits the cap). One HTTP `POST /ingest/events` per flush.
3. **Ingest** — `tracker-ingest` validates the API key, parses JSON,
   `LPUSH`es to Redis. No storage, no enrichment — the goal is to absorb
   bursts without a Node runtime in the hot path.
4. **Drain** — `tracker-server`'s `RedisIngestConsumer` plugin runs `RPOP`
   in batches of 100 every 500 ms.
5. **Pipeline** — server-side enrichers → plugin `onIngest` (can veto) →
   dedup check (5-min window by default) → stamp (id, status, receivedAt)
   → plugin `onEvent` (concurrent waves).
6. **Storage** — `EventStoragePlugin` batch-INSERTs into Postgres
   (TimescaleDB hypertable in production).

The dashboard polls `tracker_events` directly via the consumer's
[query API](/docs/api/query/), and the [SSE stream](/docs/api/query/#sse) pushes
new events to open dashboards within ~2 seconds of insertion.

## Client-side capture pipeline

```mermaid
flowchart TB
    Cap(["capture()"])
    MinLvl{"minLevel<br/>filter"}
    Drop1[Dropped]
    Rate{"rate-limit<br/>guard"}
    Drop2[Rate limited]
    Enrich["Enrichers<br/>(sync/async)"]
    Plug["plugin.onCapture(…)"]
    Before{"beforeSend"}
    Drop3[Dropped]
    Q["Queue"]
    THTTP["HTTP transport →<br/>POST /ingest/events<br/>(X-Tracker-Key)"]
    TDirect["DirectTransport →<br/>TrackerService.track()<br/>in-process"]

    Cap --> MinLvl
    MinLvl -->|drop| Drop1
    MinLvl -->|pass| Rate
    Rate -->|drop| Drop2
    Rate -->|allow| Enrich
    Enrich --> Plug
    Plug --> Before
    Before -->|null| Drop3
    Before -->|event| Q
    Q -->|HTTP| THTTP
    Q -->|Direct| TDirect

    classDef drop      fill:#7f1d1d,stroke:#ef4444,color:#fecaca,stroke-width:2px
    classDef queue     fill:#312e81,stroke:#6366f1,color:#e0e7ff,stroke-width:2px
    classDef transport fill:#064e3b,stroke:#10b981,color:#d1fae5,stroke-width:2px

    class Drop1,Drop2,Drop3 drop
    class Q queue
    class THTTP,TDirect transport
```

`DirectTransport` is used by NestJS apps that want to track their own
errors into their own `TrackerModule` — no localhost HTTP loop. See the
[TypeScript SDK guide](/docs/sdk/typescript/#in-process-self-tracking).

## Server-side processing

```mermaid
flowchart TB
    HTTP["POST /api/events<br/>(direct HTTP)"]
    REDIS["Redis LIST consumer<br/>(from tracker-ingest)"]

    subgraph Service[" TrackerService "]
        MAX["maxEventBytes —<br/>truncate long payloads"]
        ENR["server enrichers<br/>(sync)"]
        ING["plugin onIngest<br/>(sequential, can veto)"]
        DED{"dedup check<br/>5-min default"}
        SKIP[Skipped]
        STMP["stamp id + status"]
        WAVE["plugin onEvent<br/>(concurrent waves)"]
    end

    STORE["EventStoragePlugin<br/>INSERT batched"]
    NOTIFY["Notifications<br/>(Slack · email)"]
    PROM["PrometheusPlugin"]
    FWD["ForwardingPlugin<br/>(POST → other endpoint)"]

    HTTP  --> MAX
    REDIS --> MAX
    MAX --> ENR --> ING --> DED
    DED -->|duplicate| SKIP
    DED -->|unique| STMP --> WAVE
    WAVE --> STORE
    WAVE --> NOTIFY
    WAVE --> PROM
    WAVE --> FWD

    classDef skip   fill:#7f1d1d,stroke:#ef4444,color:#fecaca,stroke-width:2px
    classDef input  fill:#064e3b,stroke:#10b981,color:#d1fae5,stroke-width:2px
    classDef plugin fill:#1e1b4b,stroke:#818cf8,color:#c7d2fe,stroke-width:2px

    class SKIP skip
    class HTTP,REDIS input
    class STORE,NOTIFY,PROM,FWD plugin
```

Plugins are how every behaviour above is wired in — storage, dedup,
notifications, Prometheus, even the Redis consumer itself. The library
ships with the common ones; consumers add their own by passing them into
`TrackerModule.register({ plugins: […] })`.

## Database

**Production** — TimescaleDB hypertable on `receivedAt`, 1-day chunks,
auto-compression after 7 days, segmented by `(appId, type)`.

**Schema:**

| Column       | Type        | Notes                               |
|--------------|-------------|-------------------------------------|
| `id`         | uuid        | server-assigned, primary key         |
| `type`       | varchar     | `error \| warning \| info \| debug \| event` |
| `message`    | text        | event description                    |
| `appId`      | varchar     | source application (indexed)         |
| `category`   | varchar     | optional grouping (e.g. `db:query-failed`) |
| `status`     | varchar     | lifecycle: `new \| viewed \| resolved \| …` |
| `payload`    | jsonb       | arbitrary structured data            |
| `error`      | jsonb       | `{ name, message, stack }`           |
| `context`    | jsonb       | userId, sessionId, environment, etc. |
| `tags`       | text        | comma-separated                      |
| `timestamp`  | bigint      | client capture time (Unix ms)        |
| `receivedAt` | bigint      | server ingest time (Unix ms, partition key) |

**Indexes** (production): B-tree on `type`, `appId`, `category`, `status`,
`receivedAt DESC`; composite `(appId, type, receivedAt DESC)` for the
primary dashboard query path; GIN `jsonb_path_ops` on `payload` and
`context` so `WHERE payload @> '{"orderId":"123"}'::jsonb` hits an index;
expression indexes on `context->>'userId'`, `context->>'environment'`,
`context->>'sessionId'`.

For development the InMemory adapter or a vanilla Postgres install both
work; only the production deployment turns on the TimescaleDB features.

## Deployment

The production deployment runs on a single EC2 host (the deploy host,
`<deploy-host-ip>`). Three processes (Go ingest, Node consumer, dashboard
served from the consumer), three stateful containers (TimescaleDB, Redis,
plus an unrelated Postgres for another service), nginx in front for SSL
and routing.

```mermaid
flowchart TB
    Internet([Internet])

    subgraph EC2[" deploy host · <deploy-host-ip> "]
        NGINX["nginx :443"]
        Go["tracker-ingest<br/>PM2 :4011"]
        Nest["tracker-server<br/>PM2 :4010"]
        Redis[("Redis :6380")]
        TSDB[("TimescaleDB :5436")]
    end

    Internet -->|HTTPS| NGINX
    NGINX -->|/ingest/*| Go
    NGINX -->|/api/*| Nest
    NGINX -->|/dashboard| Nest
    NGINX -->|/docs| Nest

    Go    -->|LPUSH| Redis
    Nest  -->|RPOP| Redis
    Nest  --> TSDB

    classDef internet fill:#1e1b4b,stroke:#6366f1,color:#c7d2fe,stroke-width:2px
    classDef nginx    fill:#292524,stroke:#78716c,color:#d6d3d1,stroke-width:2px
    classDef app      fill:#064e3b,stroke:#10b981,color:#d1fae5,stroke-width:2px
    classDef docker   fill:#1e3a5f,stroke:#3b82f6,color:#bfdbfe,stroke-width:2px

    class Internet internet
    class NGINX nginx
    class Go,Nest app
    class Redis,TSDB docker
```

See [Operations → Deploy](/docs/operations/deploy/) for the full deploy
workflow, and [Operations → Configuration](/docs/operations/config/) for every
env var the consumer reads.

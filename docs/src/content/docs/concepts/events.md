---
title: Events
description: The five event types, what each means, and the lifecycle status of stored events.
sidebar:
  order: 2
---

A **tracker event** is a single signal captured from one of your apps —
an error, a log line, a domain event ("user_signed_up"), anything you
want to inspect later. The wire format is the same everywhere; what
changes is the value of `type`.

## Event types

Five types, ordered by severity. Filtered by `minLevel` on the emitter
side — events below the threshold never leave the queue.

| `type`     | When you'd emit it                                  | Default in dashboard |
|------------|-----------------------------------------------------|----------------------|
| `error`    | Exceptions, failed operations, anything that woke a human | shown |
| `warning`  | Degraded state, recoverable issues, retry exhaustion | shown |
| `info`     | Significant operations — login, checkout, deployment | shown |
| `debug`    | Domain-specific diagnostic state — auction state, weird data | hidden in prod |
| `event`    | Custom analytics — page_view, button_click, etc.    | shown (always passes minLevel) |

`event` always passes the severity filter — it's a category, not a
severity. The other four are an ordered scale: `minLevel: 'info'` drops
both `debug` and lower in production builds without any extra config.

## Convenience methods

Every emitter exposes shortcuts that map onto the wire-format `type`.

```ts
tracker.error  (new Error('oops'),       { orderId: 1 });   // type='error'
tracker.warn   ('rate-limit hit',        { ip: '1.2.3.4' });// type='warning'
tracker.info   ('deploy_started',        { sha: 'abc' });   // type='info'
tracker.debug  ('cache miss',            { key: 'foo' });   // type='debug'
tracker.event  ('button_click',          { id: 'cta-1' }); // type='event'

// Domain shorthand: 'category:name' splits automatically.
tracker.track  ('auction:stale-state',   { auctionId: 1 });
// → { type: 'event', category: 'auction', message: 'stale-state', ...}
```

## Status lifecycle

When the consumer ingests an event, it stamps a `status` so you can
triage in the dashboard. Statuses are advisory — you decide when to
move them.

| Status         | Meaning                                                |
|----------------|--------------------------------------------------------|
| `new`          | Just ingested, not yet reviewed.                       |
| `viewed`       | Someone opened the event in the dashboard.             |
| `acknowledged` | A human is aware and will handle it.                   |
| `in_progress`  | Actively being investigated or fixed.                  |
| `resolved`     | Root cause addressed and deployed.                     |
| `wont_fix`     | Intentionally ignored — not worth fixing.              |
| `archived`     | Hidden from default views (still queryable).           |

Updates go through `PATCH /api/events/:id/status` — see
[Query API](/docs/api/query/#patch-status).

## What's stored

Every event ends up as a row in `tracker_events`. Schema and indexes are
in [Architecture → Database](/docs/concepts/architecture/#database).

## Adding context to events

Three places to attach extra data:

1. **`payload`** — anything specific to this one event (`{ orderId: 5 }`).
2. **`context`** — sticky values: `setContext({ userId, environment })`
   stamps every subsequent event. Set once at boot / login.
3. **`tags`** — free-form strings for search (`['auto-capture', 'k8s-pod-x']`).

Use `payload` for unique-per-event data; `context` for everything else.

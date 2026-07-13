---
title: Dashboard
description: The self-hosted event browser at /dashboard — search, filters, summary, columns.
sidebar:
  order: 2
---

The dashboard is a single static HTML/CSS/JS bundle served from
`tracker-server` at `DASHBOARD_PATH` (default `/dashboard`). No build
step for consumers — the assets ship with the consumer install.

## What it shows

- **Stats bar** — total events, errors, warnings (live).
- **Filter toolbar** — App-ID multi-select, Category multi-select, Type
  multi-select, Status, date range, payload key=value pairs, columns
  picker. Live-filter toggle re-runs the query on every edit (debounced).
- **Summary panel** (toggle) — pie / bar / line charts grouped by type
  or appId. Click any segment to drill into that filter combo.
- **Events table** — columns are draggable to resize and reorder; the
  list is newest-first and never auto-scrolls.
- **Detail panel** — JSON dump + status update for the selected event.
- **Theme toggle** (top right) — light / dark / OS preference. Persists
  in `localStorage` under `tracker:ui:theme`.

## Filters

| Field        | Behaviour                                                              |
|--------------|------------------------------------------------------------------------|
| **Apps**     | Multi-select dropdown populated from `GET /api/events/distinct?field=appId`. |
| **Category** | Multi-select dropdown populated from `GET /api/events/distinct?field=category`. |
| **Type**     | Multi-select dropdown — `error / warning / info / debug / event`.     |
| **Status**   | Exact dropdown.                                                        |
| **From / To**| Datetime-local pickers — match against `receivedAt`.                   |
| **Payload**  | Add `key=value` rows. Each becomes a JSONB containment query on the server. |

The **Live filter** checkbox in the stats bar makes every filter edit
re-run the query (~250ms debounce). Hides the Apply button when on. Off
by default — Apply remains the trigger.

## Keyboard shortcuts

| Key         | Action                              |
|-------------|-------------------------------------|
| `R`         | Refetch — re-runs the current query.|
| `F`         | Open the App-ID picker.             |
| `S`         | Toggle the Summary panel.           |
| `Escape`    | Close the detail panel.             |

## URL parameters

The dashboard treats three query params as overrides:

- `?endpoint=https://other.host` — connect to a different consumer.
- `?prefix=/v2` — set the API prefix when the consumer mounts at
  something other than `/api`.
- `?event_id=<uuid>` — open the detail panel on that specific event,
  fetched via `GET /api/events/:id` even if it isn't in the current
  results window. Row clicks update this param via `history.replaceState`,
  so any selected event is shareable as a URL.

So pinning a developer to a staging instance is a one-link ask:
`https://tracker.ryanweiss.net/dashboard?endpoint=https://stg.tracker.ryanweiss.net&prefix=/api`.

And handing someone a permalink to a specific incident:
`https://tracker.ryanweiss.net/dashboard?event_id=c4f9a0e8-…`.

## Disabling

Set `DASHBOARD_ENABLED=false` in tracker-server's env to omit the
controller entirely. The API surface remains; only the UI goes away.
Useful for hardened deploys that want to keep the attack surface small.

## Live URL

Production: [tracker.ryanweiss.net/dashboard](https://tracker.ryanweiss.net/dashboard)

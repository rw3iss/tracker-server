---
title: HTTP — no SDK
description: Send events from any language by hand-crafting the HTTP request.
sidebar:
  order: 4
---

The wire format is intentionally simple — JSON over HTTP, one POST per
batch. If your language doesn't have a tracker SDK yet, you can emit
events directly from a curl, a shell loop, a CI step, or whatever you
have.

## Single event from bash

```bash
TRACKER_KEY="$(op read op://prod/tracker/api-key)"
TS=$(date +%s%3N)

curl -fsS -X POST https://tracker.ryanweiss.net/ingest/events \
  -H "Content-Type: application/json" \
  -H "X-Tracker-Key: $TRACKER_KEY" \
  -d @- <<EOF
{
  "type":      "info",
  "message":   "deploy_completed",
  "appId":     "ci",
  "timestamp": $TS,
  "payload":   { "sha": "$(git rev-parse HEAD)", "branch": "$(git branch --show-current)" },
  "context":   { "environment": "production" }
}
EOF
```

## Batch

```bash
curl -fsS -X POST https://tracker.ryanweiss.net/ingest/events \
  -H "Content-Type: application/json" \
  -d '[
    { "type": "info",  "message": "deploy_started", "timestamp": 1704067200000 },
    { "type": "info",  "message": "build_completed","timestamp": 1704067260000 },
    { "type": "info",  "message": "deploy_completed","timestamp": 1704067320000 }
  ]'
```

## NDJSON streaming for large bulk imports

Useful for backfilling a log archive or replaying captured events.

```bash
# Stream events line-by-line, no need to load the whole file into memory.
cat events.ndjson | curl -fsS -X POST \
  https://tracker.ryanweiss.net/api/events/stream \
  -H "Content-Type: application/x-ndjson" \
  --data-binary @-
```

Response: `{ "ok": true, "processed": N, "errors": M }`. Malformed
lines bump `errors` but don't abort the stream.

## Required field cheat sheet

```json
{ "type": "info", "message": "any non-empty string", "timestamp": 1704067200000 }
```

Everything else is optional. See [API → Ingestion](/docs/api/ingestion/)
for the full field table.

## Idempotency

The wire format isn't idempotent by default — POST the same event
twice, get two rows in the dashboard. If you need at-most-once
behaviour, either:

1. Enable [deduplication](/docs/operations/config/#deduplication) on the
   server (5-minute window, fingerprint on `type + appId + message`),
   or
2. Add a stable `id` field to your events (not currently honored — see
   [open issues](https://github.com/rw3iss/tracker/issues)).

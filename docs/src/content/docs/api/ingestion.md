---
title: Ingestion
description: POST /ingest/events — single events, batches, and NDJSON streaming.
sidebar:
  order: 2
---

The ingestion surface is what every emitter — TS, Go, PHP, raw curl —
posts to. Production traffic goes through `tracker-ingest` (Go), which
validates and `LPUSH`es to Redis. Development traffic can post directly
to the consumer at `/api/events`; the wire format is the same.

## Single event

```http
POST /ingest/events
Content-Type: application/json
X-Tracker-Key: optional

{
  "type":      "error",
  "message":   "Payment failed",
  "appId":     "buyer-portal",
  "timestamp": 1704067200000,
  "payload":   { "orderId": 12345, "amount": 99.95 },
  "error":     { "name": "TypeError", "message": "...", "stack": "..." },
  "context":   { "userId": "user-123", "environment": "production" }
}
```

Response: `201 Created`, body `{ "ok": true }`.

## Batch — array body

```http
POST /ingest/events
Content-Type: application/json

[
  { "type": "info",  "message": "deploy_started", "timestamp": 1704067200000 },
  { "type": "error", "message": "boot_failed",   "timestamp": 1704067201000 }
]
```

Same response shape. The whole array is validated before any event is
queued — if one event is malformed, the whole batch is rejected with
`400`. This lets emitters reason about partial-failure: there's no
"some succeeded, some didn't" state.

## Streaming — NDJSON

For very large payloads (e.g. crash logs replayed from disk), the
streaming endpoint reads line-delimited JSON and processes events as
they arrive — no need to buffer the whole batch in memory.

```http
POST /api/events/stream
Content-Type: application/x-ndjson

{"type":"info","message":"event 1","timestamp":1704067200000}
{"type":"error","message":"event 2","timestamp":1704067200001}
{"type":"info","message":"event 3","timestamp":1704067200002}
```

Response: `200 OK`, body `{ "ok": true, "processed": 3, "errors": 0 }`.
Malformed lines increment `errors` but don't abort the stream.

## Required fields

The minimal valid event:

```json
{ "type": "info", "message": "anything", "timestamp": 1704067200000 }
```

| Field        | Required | Notes |
|--------------|----------|-------|
| `type`       | yes      | `error \| warning \| info \| debug \| event` |
| `message`    | yes      | non-empty string                  |
| `timestamp`  | yes      | Unix ms (number)                  |
| `appId`      | no       | recommended — without it dashboard filters degrade |
| `payload`    | no       | object                            |
| `error`      | no       | `{ name, message, stack }` — present when `type === 'error'` |
| `context`    | no       | object — `userId`, `sessionId`, `environment`, etc. |
| `tags`       | no       | string[]                          |
| `category`   | no       | string                            |

Validation lives in `TrackEventDto` on the consumer side.

## Authentication

`X-Tracker-Key` header validated against a hashed allow-list on the server. **Optional only when no keys are configured** — once any keys are set on the server, the endpoint is no longer public and a missing or invalid header returns `403 Forbidden`. See [API contract → Authentication](/docs/api/contract/#authentication).

## Errors

| Status | Meaning                                                 |
|--------|---------------------------------------------------------|
| `201`  | Single or batch ingested.                               |
| `200`  | NDJSON stream completed (see body for partial errors).  |
| `400`  | Validation failed — body has the failed-rule list.      |
| `403`  | API key present but invalid.                            |
| `5xx`  | Server-side problem; safe to retry with backoff.        |

The TS SDK retries `5xx` automatically; emitters in other languages should
do the same. `4xx` responses are NOT retried — they indicate a bug.

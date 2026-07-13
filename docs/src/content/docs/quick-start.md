---
title: Quick start
description: From "I want to send an event" to "I see it in the dashboard" in under 2 minutes.
---

Pick the language that matches the service you're emitting from. Every
language sends the same wire format — see the [API contract](/docs/api/contract/)
for the canonical event shape.

## TypeScript / JavaScript

```bash
npm install @rw3iss/tracker
```

```ts
import { TrackerClient, tracker } from '@rw3iss/tracker';

TrackerClient.init({
    endpoint:    'https://tracker.ryanweiss.net/ingest/events',
    appId:       'my-service',
    environment: 'production',
    autoCapture: true,                  // window.onerror + unhandledrejection
});

// Anywhere in the codebase:
tracker.error(new Error('Payment failed'),    { orderId: 123 });
tracker.warn ('Auction ending soon',          { auctionId: 456 });
tracker.info ('User logged in',               { userId: 'u_789' });
tracker.event('checkout_completed',           { value: 99.95, currency: 'USD' });
```

That's the full integration. The SDK queues events client-side and POSTs in
batches; failures retry with backoff. See the [TypeScript SDK page](/docs/sdk/typescript/)
for plugins (breadcrumbs, analytics, GA, …) and the full config surface.

## Go

```bash
go get github.com/rw3iss/tracker-go
```

```go
import "github.com/rw3iss/tracker-go"

tracker.Init(tracker.Config{
    Endpoint: "https://tracker.ryanweiss.net/ingest/events",
    AppID:    "my-go-service",
})

tracker.Error(err, map[string]any{ "order_id": 123 })
tracker.Info("payout_completed", map[string]any{ "amount": 99.95 })
```

See the [Go SDK page](/docs/sdk/go/) for the rest.

## PHP

```bash
composer require rw3iss/tracker
```

```php
\rw3iss\Tracker::init([
    'endpoint' => 'https://tracker.ryanweiss.net/ingest/events',
    'appId'    => 'my-legacy-service',
]);

\rw3iss\Tracker::error($e, ['order_id' => 123]);
\rw3iss\Tracker::info('cron_completed', ['job' => 'reindex']);
```

## HTTP — any language, no SDK

```bash
curl -X POST https://tracker.ryanweiss.net/ingest/events \
  -H "Content-Type: application/json" \
  -d '{
    "type":      "info",
    "message":   "deploy_started",
    "appId":     "ci",
    "timestamp": '$(date +%s%3N)',
    "payload":   { "version": "v3.7.1" }
  }'
```

See the [HTTP wire format](/docs/api/ingestion/) for batching and the streaming
endpoint.

## Verify it landed

Open [tracker.ryanweiss.net/dashboard](https://tracker.ryanweiss.net/dashboard).
Filter by your `appId` — the event should appear within a couple of seconds
(SSE) or up to 5 seconds (polling fallback).

## Where to next

- [Architecture](/docs/concepts/architecture/) — how the pieces connect
- [Event types](/docs/concepts/events/) — error / warning / info / debug / event
- [Configuration](/docs/operations/config/) — every env var tracker-server reads
- [Dashboard](/docs/operations/dashboard/) — search, filters, summary, columns

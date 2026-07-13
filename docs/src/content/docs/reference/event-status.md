---
title: Event status
description: The lifecycle states a stored event passes through, and what they mean.
sidebar:
  order: 3
---

| Status         | Meaning                                                |
|----------------|--------------------------------------------------------|
| `new`          | Just ingested, not yet reviewed.                       |
| `viewed`       | Someone opened the event in the dashboard.            |
| `acknowledged` | A human is aware and will handle it.                  |
| `in_progress`  | Actively being investigated or fixed.                 |
| `resolved`     | Root cause addressed and deployed.                    |
| `wont_fix`     | Intentionally ignored — not worth fixing.             |
| `archived`     | Hidden from default views (still queryable).          |

Update via `PATCH /api/events/:id/status` — see
[Query API → PATCH](/docs/api/query/#patch-apieventsidstatus--update-lifecycle).

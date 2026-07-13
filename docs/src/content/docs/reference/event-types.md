---
title: Event types
description: The five types, severity ordering, and what to use them for.
sidebar:
  order: 2
---

```
error  >  warning  >  info  >  debug      ── severity scale (`minLevel`)
                                    event  ── always passes (category, not severity)
```

| `type`     | When                                                         |
|------------|--------------------------------------------------------------|
| `error`    | Exceptions, failed operations, anything that woke a human.   |
| `warning`  | Degraded state, recoverable issues, retry exhaustion.        |
| `info`     | Significant operations — login, checkout, deployment.        |
| `debug`    | Domain-specific diagnostic state — auction state, weird data.|
| `event`    | Custom analytics — page_view, button_click, etc. Always passes severity. |

`tracker.error / .warn / .info / .debug / .event` are convenience
methods that set `type` accordingly. See
[Concepts → Events](/docs/concepts/events/) for richer guidance.

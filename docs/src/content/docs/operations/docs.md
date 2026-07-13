---
title: This docs site
description: Building, serving, and disabling the docs site you're reading.
sidebar:
  order: 4
---

The docs site lives at `tracker-server/docs/` as an Astro Starlight
project. tracker-server serves the built static bundle at
`DOCS_PATH` (default `/docs`) when `DOCS_ENABLED=true`.

## Local development

```bash
cd tracker-server/docs
pnpm install
pnpm dev      # http://localhost:4321
```

The dev server hot-reloads markdown changes — write a page, save,
refresh.

## Building the static bundle

```bash
cd tracker-server/docs
pnpm build    # writes ./dist
```

`tracker-server`'s deploy workflow runs `pnpm docs:build` (a wrapper
around the same `astro build`) so a fresh deploy always ships the
latest content.

## Serving — how it works

tracker-server's `TrackerDocsController` serves files out of
`docs/dist/` with the same path-traversal guard the dashboard uses:

- `GET /docs` (or `/docs/`) → `docs/dist/index.html`
- `GET /docs/anything-else` → file under `docs/dist/`, 404 if missing

When `DOCS_ENABLED=false`, the controller is skipped at module
registration time — no route at all, even for the assets.

## Disabling

```sh
# tracker-server/.env
DOCS_ENABLED=false
```

Restart pm2 after the change.

## Mounting at a different path

```sh
# tracker-server/.env
DOCS_PATH=manual            # → served at /manual
```

The Astro build needs to know the mount path so its internal links
resolve. Set `DOCS_BASE` to match before running `pnpm docs:build`:

```sh
DOCS_BASE=/manual pnpm docs:build
```

## Editing content

All pages live in `tracker-server/docs/src/content/docs/`. The folder
is the URL — `concepts/architecture.md` becomes `/docs/concepts/architecture/`.

Every page has frontmatter:

```md
---
title: Page title
description: Short summary for search results / link cards.
sidebar:
  order: 1     # lower numbers sort first within their section
---

...content...
```

The sidebar groups (`Welcome`, `Concepts`, `HTTP API`, `SDKs`, …)
auto-generate from the folder structure — see `astro.config.mjs`.

## Search

Starlight's built-in pagefind index runs at build time. No config —
press `/` or click the search bar.

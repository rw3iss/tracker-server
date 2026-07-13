/**
 * bootstrap-env.ts — side-effect-only env loader, imported FIRST in
 * main.ts. Lives in its own file because of an SWC-specific compile
 * trap:
 *
 *   In source, `require('dotenv').config()` comes after the
 *   `import { AppModule } from './app.module'` line — but SWC
 *   hoists every ESM `import` statement above any bare `require()`
 *   in the emitted CommonJS output. The result was that
 *   `app.module.ts` (and the entire dependency graph below it)
 *   evaluated BEFORE dotenv had populated `process.env`, so reads
 *   like `process.env.DASHBOARD_PATH` came back undefined and the
 *   defaults won.
 *
 * Putting dotenv + reflect-metadata inside their own module means
 * SWC compiles `import './bootstrap-env'` to a `require('./bootstrap-env')`
 * that runs (with full side effects) BEFORE any sibling imports in
 * main.ts. The require chain inside this file then completes
 * synchronously — so by the time `import { AppModule }` executes,
 * `process.env` is already populated.
 *
 * Don't try to "simplify" by moving these calls back into main.ts —
 * the whole point of this file is to be the first import.
 */
// `override: true` so values declared in `.env` win over anything PM2,
// systemd, or the launching shell happened to set (often as empty).
// Without this, an outer-scope `TRACKER_API_KEYS=` (empty) silently
// shadows the multi-line list defined in `.env` and the ingestion gate
// stays public despite the file being correct.
require('dotenv').config({ override: true });
require('reflect-metadata');

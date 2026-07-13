/**
 * scripts/clear-events.ts — admin CLI for nuking tracker events.
 *
 * Boots the Nest application context (no HTTP server, no listener)
 * and calls `TrackerService.clearEvents(filters)` directly. Same code
 * path as the `POST /api/admin/clear-events` HTTP endpoint, just
 * bypasses HTTP and admin-key auth — the assumption is that whoever
 * has shell access on the box is allowed to run this.
 *
 * Usage:
 *
 *   # Wipe everything (requires --all)
 *   pnpm tracker:clear-events --all
 *
 *   # Wipe a single app
 *   pnpm tracker:clear-events --app-id dev-alt-rw3iss
 *
 *   # Wipe debug events older than a week
 *   pnpm tracker:clear-events --type debug \
 *     --before "$(date -d '1 week ago' +%s%3N)"
 *
 *   # Dry-run (count only, no delete)
 *   pnpm tracker:clear-events --app-id foo --dry-run
 *
 * Flags:
 *
 *   --all              | Required when no filter narrows the delete.
 *                      | Prevents `pnpm tracker:clear-events` from
 *                      | wiping the whole table by accident.
 *   --dry-run          | Print the count that would be deleted, then exit
 *                      | without deleting. Uses query() under the hood.
 *
 *   Filters (any combination, AND-matched):
 *   --app-id <s>       | Match a single appId exactly.
 *   --app-ids <a,b,c>  | Match any of the listed appIds (exact).
 *   --type <s>         | error | warning | info | debug | event
 *   --status <s>       | new | viewed | acknowledged | …
 *   --category <s>     | Match a category exactly.
 *   --user-id <s>      | Match context.userId exactly.
 *   --environment <s>  | Match context.environment exactly.
 *   --since <ms>       | Unix ms — only events with receivedAt >= since
 *   --before <ms>      | Unix ms — only events with receivedAt <= before
 *
 *   --help, -h         | Show this help.
 *
 * Exit codes:
 *   0 — success
 *   1 — usage error (missing --all on a full wipe, unknown flag, etc.)
 *   2 — runtime error (DB connection, etc.)
 */

import { NestFactory }              from '@nestjs/core';
import { TrackerService }            from '@rw3iss/tracker/consumer';
import type { ITrackerStorageFilter } from '@rw3iss/tracker/storage';
import { AppModule }                 from '../src/app.module';

interface ParsedArgs {
    filters: ITrackerStorageFilter;
    all:     boolean;
    dryRun:  boolean;
}

const HELP = `
tracker-server clear-events — delete stored tracker events.

Usage:
  pnpm tracker:clear-events [filters] [--dry-run]
  pnpm tracker:clear-events --all          (wipe everything)

Filters (any combination, AND-matched):
  --app-id <s>           single appId, exact match
  --app-ids <a,b,c>      OR-list of appIds, exact match
  --type <s>             error | warning | info | debug | event
  --status <s>           new | viewed | acknowledged | in_progress | resolved | wont_fix | archived
  --category <s>         exact match
  --user-id <s>          context.userId exact
  --environment <s>      context.environment exact
  --since <ms>           Unix ms — keep events received before this
  --before <ms>          Unix ms — keep events received after this
  --dry-run              count what would be deleted; do not delete
  --all                  required when no filter is given (full wipe guard)
  --help, -h             show this help
`;

function parseArgs(argv: string[]): ParsedArgs {
    const out: ParsedArgs = { filters: {}, all: false, dryRun: false };
    const args = argv.slice(2);
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        const next = () => {
            if (i + 1 >= args.length) {
                console.error(`Missing value after ${a}`);
                process.exit(1);
            }
            return args[++i];
        };
        switch (a) {
            case '--help': case '-h': console.log(HELP); process.exit(0); break;
            case '--all':         out.all     = true; break;
            case '--dry-run':     out.dryRun  = true; break;
            case '--app-id':      out.filters.appId       = next(); break;
            case '--app-ids':     out.filters.appIds      = next().split(',').map(s => s.trim()).filter(Boolean); break;
            case '--type':        out.filters.type        = next() as ITrackerStorageFilter['type']; break;
            case '--status':      out.filters.status      = next() as ITrackerStorageFilter['status']; break;
            case '--category':    out.filters.category    = next(); break;
            case '--user-id':     out.filters.userId      = next(); break;
            case '--environment': out.filters.environment = next(); break;
            case '--since':       out.filters.from        = Number(next()); break;
            case '--before':      out.filters.to          = Number(next()); break;
            default:
                console.error(`Unknown flag: ${a}\n` + HELP);
                process.exit(1);
        }
    }
    return out;
}

function isFullWipe(f: ITrackerStorageFilter): boolean {
    return !f.appId && !f.appIds?.length &&
           !f.type && !f.status && !f.category &&
           !f.userId && !f.environment &&
           f.from === undefined && f.to === undefined;
}

async function main(): Promise<void> {
    const { filters, all, dryRun } = parseArgs(process.argv);

    if (isFullWipe(filters) && !all) {
        console.error(
            'Refusing to delete every event. Pass --all to confirm a full wipe,\n' +
            'or narrow with one of --app-id / --type / --before / etc.\n' +
            HELP,
        );
        process.exit(1);
    }

    const app = await NestFactory.createApplicationContext(AppModule, {
        logger: ['error', 'warn'],
    });
    try {
        const service = app.get(TrackerService);

        if (dryRun) {
            // Re-uses the existing query path. Limit is bumped to make the
            // count meaningful for large wipes; CLI ops are interactive.
            const matched = await service.query({ ...filters, limit: 100_000 });
            console.log(`[dry-run] ${matched.length} event(s) match the filter.`);
            if (matched.length === 100_000) {
                console.log('[dry-run] Hit the 100k cap — actual delete may be larger.');
            }
            return;
        }

        const deleted = await service.clearEvents(filters);
        if (deleted < 0) {
            console.log('Cleared (no count available — adapter does not report).');
        } else {
            console.log(`Cleared ${deleted} event(s).`);
        }
    } finally {
        await app.close();
    }
}

main().catch((err) => {
    console.error('Failed:', err.message ?? err);
    process.exit(2);
});

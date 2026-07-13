import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import * as fs   from 'node:fs';
import * as path from 'node:path';
import { serveAsset, writeAssetResult } from './static-bundle';
// Tokens live in their own file to avoid a controller↔module circular
// import — `@Inject(DASHBOARD_MOUNT_PATH)` runs at class-declaration
// time, before the module's exports finish evaluating.
import { DASHBOARD_API_PREFIX, DASHBOARD_MOUNT_PATH, DASHBOARD_UPDATE_MODE } from './static-bundle-tokens';

/**
 * Serves the self-hosted HTML dashboard plus its static assets under
 * the configured `DASHBOARD_PATH` (default `/dashboard`, or `/` /
 * empty for a root-mount deploy).
 *
 * Mounted only when `DASHBOARD_ENABLED !== 'false'` — see app.module.ts.
 * The bundle is the dashboard source under `src/dashboard/`, copied to
 * `dist/dashboard/` by the postbuild step in package.json.
 *
 * The dashboard's `index.html` carries `{{BASE}}` placeholders for its
 * stylesheet + script tags so it works regardless of the configured
 * mount path. We replace those at request time with the actual mount
 * (`/dashboard` by default; `''` for root-mount). Assets are served
 * via the shared `static-bundle.serveAsset` helper, identical to how
 * docs assets are served — both controllers pass their respective
 * mount paths in via DI so the helper can correctly strip prefixes.
 */
@Controller('dashboard') // overridden by TrackerDashboardModule via Reflect.defineMetadata
export class TrackerDashboardController {
    /** Resolved absolute path of the bundled dashboard folder.
     *  After build, `__dirname === <project>/dist`, so the bundle sits
     *  alongside the compiled JS in `dist/dashboard/`. */
    private readonly dashboardRoot = path.resolve(__dirname, 'dashboard');

    constructor(
        /** Normalized URL base — `'/dashboard'`, `'/ui'`, `''` for root.
         *  Provided by TrackerDashboardModule.register() so the module
         *  is the single place that converts the env-string into both
         *  the router path and the runtime base. */
        @Inject(DASHBOARD_MOUNT_PATH) private readonly mountPath: string,
        /** Configured API route prefix — `'/api'`, `'/tracker'`, `''`.
         *  Substituted into `{{API_PREFIX}}` in index.html so the
         *  dashboard JS can read `window.__TRACKER_DASHBOARD_CONFIG__`
         *  to build absolute API URLs (event detail share link, etc.)
         *  without depending on a `?prefix=` query param. */
        @Inject(DASHBOARD_API_PREFIX) private readonly apiPrefix: string,
        /** Auto-update mode: `'false'` | `'auto'` | `'modal'`. Substituted
         *  into `{{UPDATE_MODE}}` in index.html and read by auto-update.js
         *  to decide whether to skip the version check entirely, run it
         *  silently, or run it and surface the changelog modal. */
        @Inject(DASHBOARD_UPDATE_MODE) private readonly updateMode: string,
    ) {}

    @Get()
    get(
        @Req() req: any, // eslint-disable-line @typescript-eslint/no-explicit-any
        @Res({ passthrough: false }) res: any, // eslint-disable-line @typescript-eslint/no-explicit-any
    ): void | { message: string } {
        const accept = (req.headers?.['accept'] as string | undefined) ?? '';
        const resRaw = res.raw ?? res;

        if (accept.includes('text/html') || accept.includes('*/*')) {
            const result = serveAsset(
                this.dashboardRoot,
                req.url ?? req.raw?.url ?? '',
                this.mountPath,
                (html, base) => substitutePlaceholders(html, base, this.apiPrefix, this.updateMode),
            );
            if (result.kind !== 'not-found') {
                writeAssetResult(resRaw, result);
                return;
            }
        }

        // Bundle missing → JSON hint matching the docs controller's
        // shape so ops gets a consistent diagnostic.
        if (!fs.existsSync(path.join(this.dashboardRoot, 'index.html'))) {
            resRaw.writeHead(200, { 'Content-Type': 'application/json' });
            resRaw.end(JSON.stringify({
                message: 'Dashboard bundle not found — re-run `pnpm build` (or `pnpm dashboard:bundle`) from tracker-server/.',
            }));
            return;
        }
        resRaw.writeHead(404);
        resRaw.end();
    }

    @Get('*')
    asset(
        @Req() req: any, // eslint-disable-line @typescript-eslint/no-explicit-any
        @Res({ passthrough: false }) res: any, // eslint-disable-line @typescript-eslint/no-explicit-any
    ): void {
        writeAssetResult(
            res.raw ?? res,
            serveAsset(
                this.dashboardRoot,
                req.url ?? req.raw?.url ?? '',
                this.mountPath,
                (html, base) => substitutePlaceholders(html, base, this.apiPrefix, this.updateMode),
            ),
        );
    }
}

/**
 * The dashboard's index.html ships with three server-side placeholders:
 *
 *   - `{{BASE}}`        — the dashboard's URL base. `<link href="{{BASE}}/css/dashboard.css">`
 *                         → `/dashboard/css/dashboard.css` or `/css/dashboard.css`
 *                         depending on whether the dashboard is at `/dashboard` or root.
 *   - `{{API_PREFIX}}`  — the configured API route prefix (`/api`, `/tracker`,
 *                         or `''`). Inlined into `window.__TRACKER_DASHBOARD_CONFIG__`
 *                         so the JS can build absolute API URLs (event share
 *                         link, etc.) without a `?prefix=` query param.
 *   - `{{UPDATE_MODE}}` — `'false'` | `'auto'` | `'modal'`. Read by auto-update.js
 *                         to decide whether to skip the version check, run it
 *                         silently, or run it and surface the changelog modal.
 *
 * Pure string replacement keeps the dashboard a build-step-free static bundle.
 */
function substitutePlaceholders(html: string, base: string, apiPrefix: string, updateMode: string): string {
    return html
        .replace(/\{\{BASE\}\}/g,        base)
        .replace(/\{\{API_PREFIX\}\}/g,  apiPrefix)
        .replace(/\{\{UPDATE_MODE\}\}/g, updateMode);
}

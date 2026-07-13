import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import * as fs   from 'node:fs';
import * as path from 'node:path';
import { serveAsset, writeAssetResult } from './static-bundle';
// Tokens live in their own file to avoid a controller↔module circular
// import — `@Inject(DOCS_MOUNT_PATH)` runs at class-declaration time,
// before the module's exports finish evaluating.
import { DOCS_MOUNT_PATH } from './static-bundle-tokens';

/**
 * Serves the static docs bundle (Astro Starlight build) under the
 * configured `DOCS_PATH` (default `/docs`).
 *
 * Mounted only when `DOCS_ENABLED !== 'false'` — see app.module.ts. The
 * bundle itself is built by `pnpm docs:build` from `docs/` and ends up
 * in `docs/dist/`. When the build is missing (fresh checkout, dev that
 * hasn't run the build), the controller responds with a small JSON hint
 * explaining what to run rather than a bare 404.
 *
 * Asset URLs in the built site are absolute against the configured
 * DOCS_BASE (the same value as DOCS_PATH), so unlike the dashboard we
 * don't need any per-request template substitution — Astro emits the
 * right paths at build time.
 *
 * The actual file IO + path-traversal guard live in `static-bundle.ts`
 * so this controller (and `TrackerDashboardController`) stay small.
 */
@Controller('docs') // overridden by app.module via Reflect.defineMetadata
export class TrackerDocsController {
    /** Resolved absolute path of the built docs folder. Astro writes to
     *  `docs/dist/`, which sits next to `dist/` after `pnpm build:all`. */
    private readonly docsRoot = path.resolve(__dirname, '../docs/dist');

    constructor(
        /** Normalized URL base — `'/docs'`, `''` for root, etc. Provided
         *  by TrackerDocsModule.register() so the helper can correctly
         *  strip the prefix off incoming asset URLs. */
        @Inject(DOCS_MOUNT_PATH) private readonly mountPath: string,
    ) {}

    @Get()
    get(
        @Req() req: any, // eslint-disable-line @typescript-eslint/no-explicit-any
        @Res({ passthrough: false }) res: any, // eslint-disable-line @typescript-eslint/no-explicit-any
    ): void | { message: string } {
        const accept = (req.headers?.['accept'] as string | undefined) ?? '';
        const resRaw = res.raw ?? res;

        if (accept.includes('text/html') || accept.includes('*/*')) {
            const result = serveAsset(this.docsRoot, req.url ?? req.raw?.url ?? '', this.mountPath);
            if (result.kind !== 'not-found') {
                writeAssetResult(resRaw, result);
                return;
            }
        }

        // No HTML response possible — fall through to the build-missing
        // hint so the operator knows what to do. (This is the one place
        // we deviate from a plain 404.)
        if (!fs.existsSync(path.join(this.docsRoot, 'index.html'))) {
            resRaw.writeHead(200, { 'Content-Type': 'application/json' });
            resRaw.end(JSON.stringify({
                message: 'Docs build not found — run `pnpm docs:build` from tracker-server/.',
            }));
            return;
        }
        resRaw.writeHead(404);
        resRaw.end();
    }

    /** Asset path under the docs mount — handed straight to `serveAsset`. */
    @Get('*')
    asset(
        @Req() req: any, // eslint-disable-line @typescript-eslint/no-explicit-any
        @Res({ passthrough: false }) res: any, // eslint-disable-line @typescript-eslint/no-explicit-any
    ): void {
        writeAssetResult(
            res.raw ?? res,
            serveAsset(this.docsRoot, req.url ?? req.raw?.url ?? '', this.mountPath),
        );
    }
}

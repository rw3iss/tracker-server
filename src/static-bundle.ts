import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Helpers for serving a static directory from a NestJS controller.
 *
 * Both `TrackerDashboardController` and `TrackerDocsController` serve a
 * pre-built static bundle (HTML + CSS + JS + assets) under a configurable
 * mount path. The two used to duplicate the file-IO, content-type lookup,
 * and path-containment guard. This module is the one place all of that
 * lives — controllers become a thin wrapper around `serveAsset`.
 */

/** Minimal content-type lookup for the file types our bundles ship. */
export function contentTypeFor(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case '.html': return 'text/html; charset=utf-8';
        case '.css':  return 'text/css; charset=utf-8';
        case '.js':   return 'application/javascript; charset=utf-8';
        case '.mjs':  return 'application/javascript; charset=utf-8';
        case '.json': return 'application/json; charset=utf-8';
        case '.svg':  return 'image/svg+xml';
        case '.png':  return 'image/png';
        case '.jpg':
        case '.jpeg': return 'image/jpeg';
        case '.webp': return 'image/webp';
        case '.woff': return 'font/woff';
        case '.woff2':return 'font/woff2';
        case '.ico':  return 'image/x-icon';
        case '.xml':  return 'application/xml; charset=utf-8';
        case '.txt':  return 'text/plain; charset=utf-8';
        default:      return 'application/octet-stream';
    }
}

/**
 * Cache header chooser:
 *   - Astro / Vite-style hashed bundles → 1 year, immutable.
 *   - Everything else → 5 minutes (HTML, plain JS, etc.).
 */
export function cacheHeaderFor(filePath: string): string {
    if (/\.[a-f0-9]{8,}\.(?:js|css|woff2?|svg|png|jpe?g)$/i.test(filePath)) {
        return 'public, max-age=31536000, immutable';
    }
    return 'public, max-age=300';
}

/**
 * Normalize a user-supplied mount path into a router segment + a URL
 * prefix. Accepts `'dashboard'`, `'/dashboard'`, `'/'`, `''`, or
 * `undefined`; root-mount cases collapse to `'/'` (router) and `''`
 * (URL prefix) so the bundle serves at the host root.
 *
 *   normalizeMount('dashboard') → { route: 'dashboard', urlBase: '/dashboard' }
 *   normalizeMount('/foo/bar')  → { route: 'foo/bar',   urlBase: '/foo/bar' }
 *   normalizeMount('/')         → { route: '/',         urlBase: '' }
 *   normalizeMount('')          → { route: '/',         urlBase: '' }
 *   normalizeMount(undefined)   → { route: '/',         urlBase: '' }
 *
 * `route` is what gets stamped into `@Controller(...)` via
 * `Reflect.defineMetadata(PATH_METADATA, ...)`. `urlBase` is the
 * literal string substituted for `{{BASE}}` in index.html, and the
 * prefix `bundleRelativePath` strips off incoming asset URLs.
 *
 * Why root-mount uses `'/'` (not `''`) for the route: Nest's
 * `addLeadingSlash('')` returns `''` (the empty-string short-circuit
 * in their helper), which leaves `@Get()` registered at the literal
 * empty path — Fastify can't route that. `addLeadingSlash('/')`
 * returns `'/'` which combines with `@Get()` to produce a valid
 * root route.
 */
export function normalizeMount(input: string | undefined | null): { route: string; urlBase: string } {
    const trimmed = (input ?? '').replace(/^\/+|\/+$/g, '');
    return {
        route:   trimmed ? trimmed       : '/',
        urlBase: trimmed ? '/' + trimmed : '',
    };
}

/**
 * Strip the mount prefix from a request URL and return the
 * bundle-relative file path. Mount-aware so root-mounted bundles
 * (mount = '') don't lose the first segment of the asset path.
 *
 *   bundleRelativePath('/dashboard/js/main.js', '/dashboard') → 'js/main.js'
 *   bundleRelativePath('/dashboard',            '/dashboard') → ''
 *   bundleRelativePath('/dashboard/',           '/dashboard') → ''
 *   bundleRelativePath('/css/dashboard.css',    '')           → 'css/dashboard.css'
 *   bundleRelativePath('/',                     '')           → ''
 */
export function bundleRelativePath(url: string, urlBase: string): string {
    const pathOnly = (url ?? '').split('?')[0] ?? '';
    if (urlBase === '') {
        // Root-mounted: every path under '/' is bundle-relative.
        return pathOnly.replace(/^\/+/, '');
    }
    if (pathOnly === urlBase || pathOnly === urlBase + '/') return '';
    if (pathOnly.startsWith(urlBase + '/'))  return pathOnly.slice(urlBase.length + 1);
    // URL didn't actually start with the mount — caller will treat as 404.
    return '';
}

/**
 * Resolve a bundle-relative path against the bundle root with a
 * containment guard. Anything that escapes the root via `..` returns
 * `null` rather than the resolved path — callers turn that into a 404.
 */
export function safeResolve(root: string, rel: string): string | null {
    const target = path.resolve(root, rel);
    if (target !== root && !target.startsWith(root + path.sep)) return null;
    return target;
}

/**
 * Result discriminator for `serveAsset` — keeps the controller out of
 * the business of writing HTTP response codes.
 */
export type AssetResult =
    | { kind: 'file';      contentType: string; cache: string; body: Buffer }
    | { kind: 'html';      body: string }
    | { kind: 'not-found' };

/**
 * Serve a static asset from a bundle root.
 *
 * @param root        Absolute path of the bundle directory.
 * @param url         Raw request URL (with query string allowed).
 * @param mountPath   Where the bundle is mounted in the URL space.
 *                    Pass the user-supplied value (e.g. `'dashboard'`,
 *                    `'/dashboard'`, `'/'`, `''`); `normalizeMount`
 *                    canonicalises it. Used for both the URL → file
 *                    path strip and the `{{BASE}}` substitution.
 * @param transformIndex
 *                    Optional transformer applied when serving an
 *                    `index.html`. Receives the raw HTML and the
 *                    bundle's URL base (`'/dashboard'`, `''` for root,
 *                    …). Returning a string lets callers do template
 *                    substitution (the dashboard's `{{BASE}}`
 *                    placeholder) without re-implementing the
 *                    resolution logic.
 *
 * Returns a discriminated `AssetResult`:
 *   - `'html'`   → render an HTML body (already template-processed).
 *   - `'file'`   → write the binary body with the given content-type + cache.
 *   - `'not-found'` → controller responds 404.
 */
export function serveAsset(
    root: string,
    url: string,
    mountPath: string,
    transformIndex?: (html: string, base: string) => string,
): AssetResult {
    const { urlBase } = normalizeMount(mountPath);
    const rel         = bundleRelativePath(url, urlBase);

    // Trailing-slash or root → serve index.html.
    if (rel === '') {
        const indexPath = path.join(root, 'index.html');
        if (!fs.existsSync(indexPath)) return { kind: 'not-found' };
        let html = fs.readFileSync(indexPath, 'utf-8');
        if (transformIndex) html = transformIndex(html, urlBase);
        return { kind: 'html', body: html };
    }

    let target = safeResolve(root, rel);
    if (!target) return { kind: 'not-found' };

    // Astro emits trailing-slash URLs that resolve to a folder with an
    // `index.html` inside — fold those down to the index file.
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
        target = path.join(target, 'index.html');
    }

    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        return { kind: 'not-found' };
    }

    return {
        kind:        'file',
        contentType: contentTypeFor(target),
        cache:       cacheHeaderFor(target),
        body:        fs.readFileSync(target),
    };
}

/**
 * Write an `AssetResult` to a Fastify/Express raw response. Centralised
 * so controllers don't repeat the writeHead/end ceremony.
 */
export function writeAssetResult(
    resRaw: { writeHead: (status: number, headers?: Record<string, string>) => unknown; end: (body?: string | Buffer) => unknown },
    result: AssetResult,
): void {
    if (result.kind === 'not-found') {
        resRaw.writeHead(404);
        resRaw.end();
        return;
    }
    if (result.kind === 'html') {
        resRaw.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        resRaw.end(result.body);
        return;
    }
    resRaw.writeHead(200, { 'Content-Type': result.contentType, 'Cache-Control': result.cache });
    resRaw.end(result.body);
}

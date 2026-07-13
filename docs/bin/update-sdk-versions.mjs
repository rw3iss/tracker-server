#!/usr/bin/env node
/**
 * Refresh src/data/sdk-versions.json before each docs build:
 *
 *   • TS: version + commit pulled from the installed @rw3iss/tracker
 *     package and the parent project's pnpm-lock.yaml. This is the SDK
 *     the production server is actually shipping, so it's the one we
 *     want stamped on the docs.
 *
 *   • Go / PHP: latest commit on `main` fetched from the GitHub API
 *     (anonymous, no token needed for public repos). Best-effort —
 *     network failures keep the existing entry rather than blowing up
 *     the build.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here       = dirname(fileURLToPath(import.meta.url));
const dataPath   = resolve(here, '../src/data/sdk-versions.json');
// docs/ is nested inside the parent tracker-server project; look one
// level up for the consumer's node_modules and lockfile.
const parentRoot = resolve(here, '../../');
const installedPkg = resolve(parentRoot, 'node_modules/@rw3iss/tracker/package.json');
const parentLock   = resolve(parentRoot, 'pnpm-lock.yaml');

const data = JSON.parse(readFileSync(dataPath, 'utf8'));

// ── TS ────────────────────────────────────────────────────────────────
if (existsSync(installedPkg)) {
    const pkg = JSON.parse(readFileSync(installedPkg, 'utf8'));
    if (typeof pkg.version === 'string') {
        data.ts.version = pkg.version;
    }
}
if (existsSync(parentLock)) {
    const lock  = readFileSync(parentLock, 'utf8');
    // Match the SHA in:  …rw3iss/tracker.git#<40-char hex>
    const match = lock.match(/rw3iss\/tracker\.git#([a-f0-9]{40})/);
    if (match) {
        data.ts.commit = match[1].slice(0, 7);
    }
}

// ── Go + PHP — latest commit on main via GitHub API ───────────────────
async function fetchLatestCommit(repo) {
    try {
        const headers = { 'User-Agent': 'tracker-docs-updater', 'Accept': 'application/vnd.github+json' };
        if (process.env.GH_TOKEN) headers['Authorization'] = `Bearer ${process.env.GH_TOKEN}`;
        const res = await fetch(`https://api.github.com/repos/rw3iss/${repo}/commits/main`, { headers });
        if (!res.ok) return null;
        const json = await res.json();
        return typeof json.sha === 'string' ? json.sha.slice(0, 7) : null;
    } catch {
        return null;
    }
}

const [goCommit, phpCommit] = await Promise.all([
    fetchLatestCommit('tracker-go'),
    fetchLatestCommit('tracker-php'),
]);
if (goCommit)  data.go.commit  = goCommit;
if (phpCommit) data.php.commit = phpCommit;

writeFileSync(dataPath, JSON.stringify(data, null, 2) + '\n');
console.log(`[update-sdk-versions] ts: ${data.ts.version} @ ${data.ts.commit ?? '?'}`);
console.log(`[update-sdk-versions] go:  @ ${data.go.commit ?? '?'}`);
console.log(`[update-sdk-versions] php: @ ${data.php.commit ?? '?'}`);

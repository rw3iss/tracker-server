/**
 * auto-update.js — version-mismatch detection + reset flow.
 *
 * Boot sequence:
 *
 *   1. Read `window.__TRACKER_DASHBOARD_VERSION_INFO__` (stamped by
 *      `bin/generate-dashboard-version.mjs` at build time).
 *   2. Compare its `version` against the one in localStorage.
 *   3. On mismatch, run the update routine:
 *        a. Capture old version + the build's changelog.
 *        b. Clear ALL app storage (localStorage + sessionStorage).
 *        c. Write the new version into localStorage.
 *        d. Show the post-update modal with old → new + changelog.
 *        e. User clicks OK → reload so every subsystem re-mounts with
 *           freshly-cleared state.
 *
 * Skipped entirely when the build version is `'dev'` (placeholder
 * shipped in source) so dev runs aren't constantly clearing storage.
 */

import { escapeHtml } from './utils.js';
import { showModal }  from './modal.js';

/** localStorage key that survives the storage wipe inside the update
 *  routine (we explicitly write it back after `clear()`). */
const VERSION_KEY = 'tracker:dashboard:version';

/**
 * Resolve the operator-configured update mode. Read from the
 * server-injected dashboard config, with `'modal'` as the back-compat
 * default. Anything other than the three known values is treated as
 * `'modal'` — same fallback behaviour as the server-side normalizer.
 */
function getUpdateMode() {
    const cfg = (typeof window !== 'undefined' && window.__TRACKER_DASHBOARD_CONFIG__) || null;
    const raw = cfg && typeof cfg.updateMode === 'string' ? cfg.updateMode.trim() : '';
    if (raw === 'false' || raw === 'auto' || raw === 'modal') return raw;
    // Fall through includes the unsubstituted '{{UPDATE_MODE}}' string
    // (older HTML bundle without the substitution) — be permissive.
    return 'modal';
}

/**
 * Run on dashboard boot. Idempotent — safe to call multiple times,
 * though main.js only calls it once.
 *
 * Behaviour depends on `TRACKER_DASHBOARD_UPDATE_MODE` (resolved via
 * `getUpdateMode()`):
 *
 *   - `'false'`  — skip the version check entirely. Stored version is
 *                  left alone. The "Changes" button still works as a
 *                  manual viewer.
 *   - `'auto'`   — silent update: wipe stale storage and re-stamp the
 *                  version, but don't show the modal.
 *   - `'modal'`  — current behaviour: wipe, re-stamp, and surface the
 *                  changelog modal so the user sees what they got.
 */
export function checkForUpdate() {
    const mode = getUpdateMode();
    if (mode === 'false') return; // operator opted out

    const info = (typeof window !== 'undefined' && window.__TRACKER_DASHBOARD_VERSION_INFO__) || null;
    const buildVersion = info?.version;

    // Dev mode (no build) → version.js placeholder ships `'dev'`. Skip
    // the auto-update routine entirely so local dev doesn't keep
    // wiping localStorage every reload.
    if (!buildVersion || buildVersion === 'dev') return;

    let storedVersion = null;
    try { storedVersion = localStorage.getItem(VERSION_KEY); } catch { /* private mode */ }

    // Up-to-date — nothing to do.
    if (storedVersion === buildVersion) return;

    // Mismatch *or* first-ever load — both run the update routine. The
    // first-load case is intentional: surfacing the modal with
    // "Previous: (not tracked)" tells the user the dashboard ships a
    // version-tracking feature, and we wipe storage to avoid carrying
    // forward stale prefs from any pre-versioning build.

    // ── Mismatch — run the update routine ────────────────────────────
    const oldVersion = storedVersion;
    const newVersion = buildVersion;

    // Wipe everything. The dashboard's prefs (theme, columns, filters,
    // panel sizes) all live in localStorage; clearing means the user
    // gets the new defaults rather than fighting stale state from a
    // schema that may have shifted between builds.
    try { localStorage.clear();   } catch { /* ignore */ }
    try { sessionStorage.clear(); } catch { /* ignore */ }

    // Re-stamp the version *after* the clear so the next boot recognizes
    // we're current.
    try { localStorage.setItem(VERSION_KEY, newVersion); } catch { /* ignore */ }

    // 'auto' mode stops here — wipe + re-stamp, no UI surfaced. The user
    // experiences a transparent state reset; if they want to see what
    // changed they can hit the "Changes" button.
    if (mode !== 'modal') return;

    showChangelogModal({
        mode:         'updated',
        oldVersion,
        newVersion,
        changelog:    info.changelog || '',
        commits:      Array.isArray(info.commits) ? info.commits : [],
        repoUrl:      info.repoUrl || '',
        builtAt:      info.builtAt || null,
        // Empty string when the user has no prior version — the renderer
        // treats that as "highlight everything", which matches the
        // first-load semantics. When a prior version exists, extract its
        // short SHA so the renderer can mark commits newer than that
        // SHA as "new since your last visit".
        prevShortSha: extractShortSha(oldVersion),
    });
}

/**
 * Extract the short SHA from a stored version string.
 * Stored format is `<shortSha>-<timestamp>`; we match the leading hex
 * run so future changes to the timestamp suffix don't break parsing.
 */
function extractShortSha(version) {
    if (typeof version !== 'string' || !version) return '';
    const m = /^([0-9a-f]+)/i.exec(version);
    return m ? m[1] : '';
}

/**
 * Trim a git ISO date ("2026-05-01T17:14:32-07:00" or
 * "2026-05-01 17:14:32 -0700") down to "2026-05-01 17:14".
 * Falls back to the input on parse failure.
 */
function shortDate(s) {
    if (!s) return '';
    // Match either ISO-8601 strict (T separator) or git-log-style (space).
    const m = /^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})/.exec(s);
    return m ? `${m[1]} ${m[2]}` : s;
}

/**
 * Build the inner HTML for the commits viewer. One row per commit:
 * hash · date · subject. Hash is a link to the repo's commit page when
 * `repoUrl` is known.
 *
 * `prevShortSha` controls the "new since your last visit" highlight:
 *
 *   - undefined  → no highlighting (manual viewer mode)
 *   - ''         → highlight every row (first-ever load: everything is new)
 *   - '<sha>'    → highlight rows newer than the row matching that SHA;
 *                  if no row matches (user is more than 80 commits behind
 *                  or on a different branch history), highlight everything.
 */
function renderCommitsHTML(commits, repoUrl, prevShortSha) {
    if (!commits || commits.length === 0) {
        return `<div class="tk-update__empty">(no commits recorded)</div>`;
    }

    // git log returns newest-first, so cutoff = index of the row at the
    // same SHA the user last saw. Rows before that index are "new".
    let cutoff = -1;
    if (prevShortSha !== undefined) {
        cutoff = commits.length;            // default: all new
        if (prevShortSha) {
            for (let i = 0; i < commits.length; i++) {
                const sh = commits[i].shortHash;
                if (!sh) continue;
                if (sh === prevShortSha || sh.startsWith(prevShortSha) || prevShortSha.startsWith(sh)) {
                    cutoff = i;
                    break;
                }
            }
        }
    }
    const newCount = cutoff > 0 ? cutoff : 0;
    const showHeader = cutoff > 0 && cutoff < commits.length; // a meaningful split

    const rows = commits.map((c, i) => {
        const isNew = i < cutoff;
        const cls = isNew ? 'tk-update__commit tk-update__commit--new' : 'tk-update__commit';
        const hash    = escapeHtml(c.shortHash || '');
        const date    = escapeHtml(shortDate(c.date || ''));
        const subject = escapeHtml(c.subject  || '');
        const hashCell = repoUrl && c.shortHash
            ? `<a class="tk-update__hash" href="${escapeHtml(repoUrl)}/commit/${hash}" target="_blank" rel="noopener noreferrer">${hash}</a>`
            : `<span class="tk-update__hash">${hash}</span>`;
        return `<div class="${cls}">${hashCell}<span class="tk-update__date">${date}</span><span class="tk-update__subject">${subject}</span></div>`;
    }).join('');

    const headerLine = showHeader
        ? `<div class="tk-update__since"><strong>${newCount}</strong> new commit${newCount === 1 ? '' : 's'} since your last visit</div>`
        : '';

    return `${headerLine}<div class="tk-update__commits">${rows}</div>`;
}

/**
 * Manually open the changelog modal — for the header "Changes" button.
 * Reads the build-time version info, doesn't touch storage, doesn't
 * reload on OK. The modal is dismissible via Esc / overlay / × so the
 * user can close it without consequence.
 */
export function showCurrentChangelog() {
    const info = (typeof window !== 'undefined' && window.__TRACKER_DASHBOARD_VERSION_INFO__) || null;
    if (!info) return;
    showChangelogModal({
        mode:       'manual',
        newVersion: info.version || 'dev',
        changelog:  info.changelog || '',
        commits:    Array.isArray(info.commits) ? info.commits : [],
        repoUrl:    info.repoUrl || '',
        builtAt:    info.builtAt || null,
    });
}

/**
 * Render the changelog modal. Two modes:
 *   - 'updated' — fired automatically after a version-mismatch wipe.
 *                 Modal is non-dismissible and OK reloads. Shows the
 *                 old→new diff and the "we cleared your prefs" intro.
 *   - 'manual'  — opened on demand from the header button. Dismissible,
 *                 OK just closes, no old version row, no intro.
 */
function showChangelogModal({ mode, oldVersion, newVersion, changelog, commits, repoUrl, builtAt, prevShortSha }) {
    const isUpdated = mode === 'updated';

    const intro = isUpdated
        ? '<p class="tk-update__intro">The dashboard has been updated to a new build. App preferences have been cleared so the new version starts from a clean state.</p>'
        : '';

    const previousRow = isUpdated
        ? `<div class="tk-update__row">
             <span class="tk-update__label">Previous:</span>
             <code class="tk-update__version">${escapeHtml(oldVersion || '(not tracked)')}</code>
           </div>`
        : '';

    const builtAtRow = builtAt
        ? `<div class="tk-update__row"><span class="tk-update__label">Built:</span> <span>${escapeHtml(builtAt)}</span></div>`
        : '';

    const bodyHTML = `
        ${intro}
        <div class="tk-update__versions">
            ${previousRow}
            <div class="tk-update__row">
                <span class="tk-update__label">${isUpdated ? 'Current:' : 'Version:'}</span>
                <code class="tk-update__version">${escapeHtml(newVersion)}</code>
            </div>
            ${builtAtRow}
        </div>
        <h4 class="tk-update__heading">Changelog</h4>
        ${renderCommitsHTML(commits, repoUrl, prevShortSha)}
    `;

    showModal({
        title:        isUpdated ? 'Dashboard updated' : 'Dashboard changelog',
        bodyHTML,
        okText:       isUpdated ? 'OK' : 'Close',
        // In 'updated' mode the modal is the only surface explaining the
        // wipe — block dismissal so the user has to acknowledge. In
        // 'manual' mode it's just a viewer; let Esc / overlay / × close.
        showClose:             !isUpdated ? true  : false,
        dismissOnEsc:          !isUpdated,
        dismissOnOverlayClick: !isUpdated,
        width:                 '65vw',
        onOk: isUpdated
            ? () => window.location.reload()
            : undefined,
    });
}

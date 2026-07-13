/**
 * url-params.js — low-level helpers for reading and writing the
 * dashboard's filter state into the address bar's query string.
 *
 * Three rules govern how the URL behaves:
 *
 *   1. **URL beats localStorage on load.** A param in the URL overrides
 *      whatever the matching `Pref` had stored. Missing params fall
 *      back to the saved value (per-key merge), so a clean URL keeps
 *      your last view; a partial URL (`?status=error`) overrides only
 *      the keys it names.
 *
 *   2. **Every change writes through.** Filter edits update both the
 *      URL (current view, shareable) and localStorage (next session).
 *      Writes go via `history.replaceState` so the back button doesn't
 *      bloat with one entry per keystroke.
 *
 *   3. **Empty deletes.** Writing `null` / `undefined` / `''` for a key
 *      removes it from the URL entirely. So a clean URL == "every
 *      filter at default", which matches how the dashboard treats
 *      empty inputs already.
 *
 * This module is the *primitives*. The actual map between dashboard
 * filters and URL keys lives in `url-sync.js`, which calls into here.
 */

/**
 * Read the current URL's query string into a flat `{ [key]: string }`.
 * Repeated keys collapse to the last value (no array form); the
 * dashboard never emits repeated keys, so this isn't a meaningful
 * limitation.
 */
export function readURLParams() {
    const out = {};
    for (const [k, v] of new URLSearchParams(window.location.search)) out[k] = v;
    return out;
}

/**
 * Merge a partial `{ [key]: string | null }` into the current URL via
 * `history.replaceState`. Keys with `null` / `undefined` / `''` get
 * removed; everything else gets set.
 *
 * Debounced so a fast multi-edit (typeahead, multi-select cascade)
 * collapses into a single history mutation. ~75ms is short enough that
 * the URL feels live, long enough that we don't replaceState 30 times
 * per second.
 */
let pendingPatch = null;
let flushTimer   = null;

export function updateURLParams(partial) {
    pendingPatch = { ...(pendingPatch ?? {}), ...partial };
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flushURLPatch, 75);
}

/** Flush any pending URL patch immediately. Useful when the caller
 *  wants the URL to reflect the new state synchronously (e.g. before
 *  copying the address bar to clipboard). */
export function flushURLPatch() {
    if (!pendingPatch) return;
    const url    = new URL(window.location.href);
    const search = url.searchParams;
    for (const [key, value] of Object.entries(pendingPatch)) {
        if (value == null || value === '') search.delete(key);
        else                               search.set(key, String(value));
    }
    pendingPatch = null;
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    history.replaceState(null, '', url);
}

// ── Codecs ────────────────────────────────────────────────────────────────
//
// A codec converts between an in-memory value and its URL string form.
// Each one is a `{ encode, decode, isEmpty }` triple. `isEmpty` decides
// whether the URL key gets dropped — separate from `decode` because the
// "empty" check should happen on the in-memory value, not the string.

/** Plain string passthrough. Empty string drops the key. */
export const STRING_CODEC = {
    encode:  v => v ?? '',
    decode:  s => s ?? '',
    isEmpty: v => v == null || v === '',
};

/** Comma-separated list. `[]` drops the key. Round-trip safe for values
 *  that don't themselves contain commas (true of our app-id / category /
 *  type lists — the server distinct API enforces that). */
export const CSV_CODEC = {
    encode:  arr => Array.isArray(arr) ? arr.join(',') : '',
    decode:  s   => (s ?? '').split(',').map(v => v.trim()).filter(Boolean),
    isEmpty: arr => !Array.isArray(arr) || arr.length === 0,
};

/** Boolean as `'1'` / absent (not `'0'`/`'true'`/`'false'`). Keeps the
 *  URL short for the common case (false → no key at all). */
export const BOOL_CODEC = {
    encode:  v => v ? '1' : '',
    decode:  s => s === '1' || s === 'true',
    isEmpty: v => !v,
};

/** Datetime-local form value (`'2026-04-30T14:30'`). Empty string drops. */
export const DATETIME_LOCAL_CODEC = STRING_CODEC;

// ── Convenience: enumerate prefixed keys ──────────────────────────────────

/**
 * Return every URL param whose key starts with `prefix`, with the prefix
 * stripped. Used by the payload-filter sync — payload entries each get
 * their own URL key (`payload.orderId=123`), and we need to enumerate
 * them on load to rebuild the row list.
 */
export function readURLParamsWithPrefix(prefix) {
    const out = {};
    for (const [k, v] of Object.entries(readURLParams())) {
        if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
    }
    return out;
}

/**
 * Remove every URL key starting with `prefix` and replace with the
 * supplied `{ [suffix]: value }` pairs. Used by the payload sync to
 * keep the address bar in lock-step with the visible payload rows
 * (delete removed entries, add new ones, update edits — all in one
 * patch).
 */
export function replacePrefixedURLParams(prefix, entries) {
    const partial = {};
    for (const k of Object.keys(readURLParams())) {
        if (k.startsWith(prefix)) partial[k] = null;
    }
    for (const [suffix, value] of Object.entries(entries)) {
        partial[prefix + suffix] = value;
    }
    updateURLParams(partial);
}

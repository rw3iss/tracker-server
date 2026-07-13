/**
 * url-sync.js — declarative URL ↔ filter-state binding.
 *
 * `bootURLSync(refs)` does two things, in order:
 *
 *   1. Read the current URL once, decode each known param, and push it
 *      into the matching filter (`pickers.apps.setSelected(...)`,
 *      `els.status.value = ...`, etc.). URL beats localStorage per-key —
 *      missing params keep the saved value.
 *
 *   2. Subscribe to `filters:changed` (and a few other state-change
 *      events) and mirror the current state back to the URL. Writes go
 *      through `url-params.updateURLParams`, which debounces and uses
 *      `history.replaceState` so the back button doesn't accumulate
 *      one entry per keystroke.
 *
 * Adding a new URL-synced filter = one entry in the `REGISTRY` array
 * inside `bootURLSync`. The codec set in `url-params.js` covers the
 * common shapes (string, CSV list, bool, datetime).
 */

import { state, bus, setLiveFilter, setSummary, setSort } from './state.js';
import {
    readURLParams,
    updateURLParams,
    readURLParamsWithPrefix,
    replacePrefixedURLParams,
    STRING_CODEC,
    CSV_CODEC,
    BOOL_CODEC,
    DATETIME_LOCAL_CODEC,
} from './url-params.js';

/**
 * @typedef {Object} URLSyncRefs
 * @property {{ buildQueryString: Function, save: Function, clear: Function,
 *              matches: Function,
 *              pickers: Record<string, any>,
 *              els:     Record<string, HTMLElement>,
 *              getPayloadFilters: () => Array<{key:string,value:string}>,
 *              setPayloadFilters: (rows: Array<{key:string,value:string}>) => void
 *            }} filters  The controller returned by `mountFilters()`.
 */

/** Wire the URL ↔ state bridge. Call once, after every subsystem has mounted
 *  and before `doConnect()` runs (so the initial fetch uses URL-resolved
 *  values).
 *
 *  @param {URLSyncRefs} refs
 */
export function bootURLSync(refs) {
    const { filters } = refs;
    const REGISTRY = buildRegistry(filters);

    // ── 1. URL → state (one-shot, on boot) ────────────────────────────────
    const urlParams = readURLParams();
    let appliedAny  = false;
    for (const entry of REGISTRY) {
        const raw = urlParams[entry.urlKey];
        if (raw === undefined) continue;       // missing → keep pref/default
        const decoded = entry.codec.decode(raw);
        try { entry.write(decoded); appliedAny = true; }
        catch { /* one bad param shouldn't poison boot */ }
    }
    // Payload entries get their own enumeration since each row is its own
    // URL key (`payload.foo=bar`).
    const payloadFromURL = readURLParamsWithPrefix('payload.');
    if (Object.keys(payloadFromURL).length > 0) {
        filters.setPayloadFilters(
            Object.entries(payloadFromURL).map(([key, value]) => ({ key, value })),
        );
        appliedAny = true;
    }

    // ── 2. state → URL (on every change, debounced inside updateURLParams) ─
    const writeAllToURL = () => {
        const partial = {};
        for (const entry of REGISTRY) {
            const value = entry.read();
            partial[entry.urlKey] = entry.codec.isEmpty(value)
                ? null                 // drop the key
                : entry.codec.encode(value);
        }
        updateURLParams(partial);
        // Payload entries: special-cased. Clear any old `payload.*` keys
        // and re-emit the current rows.
        const payloadEntries = {};
        for (const pf of filters.getPayloadFilters()) {
            const k = pf.key.trim(); const v = pf.value.trim();
            if (k && v) payloadEntries[k] = v;
        }
        replacePrefixedURLParams('payload.', payloadEntries);
    };

    // The bus events that touch any URL-synced state. Listing them
    // explicitly is cheaper + clearer than a global `on('*')`.
    bus.on('filters:changed',    writeAllToURL);
    bus.on('liveFilter:changed', writeAllToURL);
    bus.on('summary:changed',    writeAllToURL);
    bus.on('filters:apply',      writeAllToURL);
    // sort:changed fires from setSort() in state.js — re-emit to URL so
    // the active column + direction become part of the shareable view.
    bus.on('sort:changed',       writeAllToURL);

    // If we applied any URL param, kick the live-filter pipeline so the
    // first fetch uses the resolved state. Without this nudge, the boot
    // sequence would still call `doConnect()` with the URL-resolved
    // values — but we want the URL to stay in sync if anything else
    // touches state during boot. The synthetic event is debounced, so
    // it costs one extra `replaceState` at most.
    if (appliedAny) writeAllToURL();
}

/** Build the registry. Lives inside this function so each entry's
 *  closures can hold live references to the filter / picker controllers. */
function buildRegistry(filters) {
    const { pickers, els } = filters;
    return [
        // Multi-select pickers ─────────────────────────────────────────
        {
            urlKey: 'apps',
            read:   () => pickers.apps?.getSelected() ?? [],
            write:  v => pickers.apps?.setSelected(v),
            codec:  CSV_CODEC,
        },
        {
            urlKey: 'categories',
            read:   () => pickers.categories?.getSelected() ?? [],
            write:  v => pickers.categories?.setSelected(v),
            codec:  CSV_CODEC,
        },
        {
            urlKey: 'types',
            read:   () => pickers.types?.getSelected() ?? [],
            write:  v => pickers.types?.setSelected(v),
            codec:  CSV_CODEC,
        },

        // Toolbar inputs ───────────────────────────────────────────────
        {
            urlKey: 'status',
            read:   () => els.status?.value ?? '',
            write:  v => { if (els.status) els.status.value = v ?? ''; },
            codec:  STRING_CODEC,
        },
        {
            urlKey: 'q',
            read:   () => els.search?.value ?? '',
            write:  v => { if (els.search) els.search.value = v ?? ''; },
            codec:  STRING_CODEC,
        },
        {
            urlKey: 'from',
            read:   () => els.from?.value ?? '',
            write:  v => { if (els.from) els.from.value = v ?? ''; },
            codec:  DATETIME_LOCAL_CODEC,
        },
        {
            urlKey: 'to',
            read:   () => els.to?.value ?? '',
            write:  v => { if (els.to) els.to.value = v ?? ''; },
            codec:  DATETIME_LOCAL_CODEC,
        },

        // Toolbar toggles ──────────────────────────────────────────────
        {
            urlKey: 'live',
            read:   () => state.liveFilter,
            write:  v => setLiveFilter(Boolean(v)),
            codec:  BOOL_CODEC,
        },

        // Active sort — column + direction. Persisting to the URL means
        // the link a user shares opens with the same row ordering they
        // were looking at. setSort() takes both values together; we
        // call it from each write, which is harmless: the second write
        // sees the first one's mutation already applied to state, and
        // the redundant 'sort:changed' emit is debounced inside
        // updateURLParams.
        {
            urlKey: 'sortBy',
            read:   () => state.sortBy,
            // Accept any non-empty string — `client:foo` keys are valid
            // alongside server keys (receivedAt, type, …). Validation
            // happens at the table layer when the column is rendered.
            write:  v => { if (typeof v === 'string' && v) setSort(v, state.sortDir); },
            codec:  STRING_CODEC,
        },
        {
            urlKey: 'sortDir',
            read:   () => state.sortDir,
            write:  v => { if (v === 'asc' || v === 'desc') setSort(state.sortBy, v); },
            codec:  STRING_CODEC,
        },

        // Summary panel state ──────────────────────────────────────────
        {
            urlKey: 'summary',
            read:   () => state.summaryOpen,
            write:  v => setSummary({ open: Boolean(v) }),
            codec:  BOOL_CODEC,
        },
        {
            urlKey: 'sgroup',
            read:   () => state.summaryGroup,
            write:  v => setSummary({ group: v === 'appId' ? 'appId' : 'type' }),
            codec:  STRING_CODEC,
        },
        {
            urlKey: 'sview',
            read:   () => state.summaryView,
            write:  v => setSummary({ view: ['pie','bar','line'].includes(v) ? v : 'pie' }),
            codec:  STRING_CODEC,
        },
    ];
}

/**
 * filters.js — owns the toolbar's filter controls (text inputs, selects,
 * date pickers, payload key=value popover) and produces a query string for
 * the API client.
 *
 * Persists every visible filter to `localStorage` so the dashboard remembers
 * the operator's last view across reloads. The "Apply" button doesn't live
 * here — that's wired in main.js since it triggers a reconnect, which is
 * outside this module's concern.
 */

import { Pref } from './prefs.js';
import { state, bus } from './state.js';
import { escapeHtml } from './utils.js';
import { mountPickerToolbar } from './pickers.js';

// Each filter input gets its own pref — defaults are inline so the
// editor for any filter input only has one place to look for the
// default and the storage key.
const PREF_STATUS    = new Pref('filter:status',   '');
const PREF_SEARCH    = new Pref('filter:search',   '');
const PREF_PAYLOAD   = new Pref('filter:payload',  [], { validate: Array.isArray });

let payloadFilters = PREF_PAYLOAD.get();

/** Multi-select picker controllers, keyed by PICKER_DEFINITIONS[i].id.
 *  Populated by mountPickerToolbar() during mountFilters(). All access is
 *  optional-chained because the picker host may be missing in tests. */
let pickers = /** @type {Record<string, any>} */ ({});

const els = {
    status:      null,
    from:        null,
    to:          null,
    search:      null,
    payloadBtn:  null,
    payloadPanel:null,
    payloadList: null,
    payloadAdd:  null,
    payloadCount:null,
    clearBtn:    null,
};

/** Mount the filter UI. Returns a controller for callers. */
export function mountFilters() {
    els.status       = document.getElementById('f-status');
    els.from         = document.getElementById('f-from');
    els.to           = document.getElementById('f-to');
    els.search       = document.getElementById('f-search');
    els.payloadBtn   = document.getElementById('btn-payload-toggle');
    els.payloadPanel = document.getElementById('payload-panel');
    els.payloadList  = document.getElementById('payload-entries');
    els.payloadAdd   = document.getElementById('btn-payload-add');
    els.payloadCount = document.getElementById('payload-count');
    els.clearBtn     = document.getElementById('btn-clear-filters');

    // Restore saved values from the per-filter Pref instances. Each
    // input has its own key so adding a new filter is a one-liner.
    els.status.value   = PREF_STATUS.get();
    els.search.value   = PREF_SEARCH.get();

    // Multi-select pickers manage their own state — we hold the
    // controllers so buildQueryString / clear / matches can talk to them.
    // mountPickerToolbar renders the toolbar fields from the registry
    // in pickers.js and returns a controllers map keyed by id
    // ('apps' / 'categories' / 'types' / …).
    pickers = mountPickerToolbar(document.getElementById('picker-toolbar'));

    renderPayloadEntries();

    // Toggle payload popover
    els.payloadBtn.addEventListener('click', e => {
        e.stopPropagation();
        els.payloadPanel.hidden = !els.payloadPanel.hidden;
    });
    document.addEventListener('click', e => {
        if (!els.payloadPanel.contains(e.target) && e.target !== els.payloadBtn) {
            els.payloadPanel.hidden = true;
        }
    });
    els.payloadAdd.addEventListener('click', () => {
        payloadFilters.push({ key: '', value: '' });
        renderPayloadEntries();
    });

    els.clearBtn.addEventListener('click', () => clear());

    // Live-filter wiring — every input fires 'filters:changed' on
    // change/input. main.js debounces and re-runs the query when
    // `state.liveFilter` is on. With it off, the events fire but
    // nothing listens, so the explicit Apply button is still the
    // only trigger.
    const emitChanged = (source) => bus.emit('filters:changed', { source });
    els.status.addEventListener('change', () => emitChanged('status'));
    els.from  .addEventListener('change', () => emitChanged('from'));
    els.to    .addEventListener('change', () => emitChanged('to'));
    // Search box: 'input' so live mode reacts to every keystroke.
    // The ~250ms debounce in main.js coalesces fast typing into one
    // fetch, so a 7-character word is one query, not seven.
    els.search.addEventListener('input', () => emitChanged('search'));
    // Picker selections also need to participate so URL-sync + live-fetch
    // notice. Each picker.setSelected emits internally on the bus
    // (see value-picker.js) — but the multi-select UI checkbox toggles
    // route through `setSelected` already, so this is covered.
    // Payload entries are rendered fresh per render; the input listener
    // is wired inside renderPayloadEntries() so new rows participate too.

    return {
        buildQueryString, save, clear, matches,
        // Live references for url-sync.js to read/write filter state
        // without poking at module internals.
        pickers,
        els,
        getPayloadFilters: () => payloadFilters.map(pf => ({ ...pf })),
        setPayloadFilters: (rows) => {
            payloadFilters = Array.isArray(rows)
                ? rows.map(r => ({ key: String(r.key ?? ''), value: String(r.value ?? '') }))
                : [];
            PREF_PAYLOAD.set(payloadFilters);
            renderPayloadEntries();
        },
    };
}

/**
 * Apply a partial filter set programmatically, then trigger a re-fetch.
 *
 * Used by the Summary panel's chart click handlers to drill down (e.g.
 * clicking the "errors / api-server" slice sets `type=error` and
 * `appId=api-server`, then reconnects the table to those filters). One
 * shared entry point keeps the chart code from reaching into the toolbar
 * inputs directly — `Pie`, `Bar`, and `Line` all call this.
 *
 * The `'filters:apply'` bus event lets `main.js` own the reconnect
 * lifecycle without exporting `doConnect`.
 *
 * @param {Partial<{ appId, category, type, status, from, to }>} partial
 */
export function applyFilters(partial = {}) {
    setFilterValues(partial);
    save();
    bus.emit('filters:apply', partial);
}

/**
 * Update the toolbar inputs from a partial filter set. Empty string clears
 * the field; `undefined` leaves the existing value alone — so callers can
 * pass only the fields they care about.
 *
 * `appId` is a single-value convenience for chart click handlers; the
 * picker accepts a list and we route appropriately.
 */
function setFilterValues(partial) {
    if (partial.appIds     !== undefined) pickers.apps?.setSelected(partial.appIds);
    if (partial.appId      !== undefined) {
        pickers.apps?.setSelected(partial.appId === '' ? [] : [String(partial.appId)]);
    }
    if (partial.categories !== undefined) pickers.categories?.setSelected(partial.categories);
    if (partial.category   !== undefined) {
        pickers.categories?.setSelected(partial.category === '' ? [] : [String(partial.category)]);
    }
    if (partial.types      !== undefined) pickers.types?.setSelected(partial.types);
    if (partial.type       !== undefined) {
        // Single-value chart click → single-element type selection.
        pickers.types?.setSelected(partial.type === '' ? [] : [String(partial.type)]);
    }
    if (partial.status     !== undefined) els.status.value   = String(partial.status);
    if (partial.from       !== undefined) els.from.value     = String(partial.from);
    if (partial.to         !== undefined) els.to.value       = String(partial.to);
    if (partial.q          !== undefined) els.search.value   = String(partial.q);
}

/** Build a URL-encoded query string for /events and /events/stream. */
export function buildQueryString() {
    const p = new URLSearchParams();
    const appIds     = pickers.apps?.serialize()       ?? '';
    const categories = pickers.categories?.serialize() ?? '';
    const types      = pickers.types?.serialize()      ?? '';
    if (appIds)     p.set('appIds',     appIds);
    if (categories) p.set('categories', categories);
    if (types)      p.set('types',      types);
    if (els.status.value)          p.set('status',   els.status.value);
    // Free-text search → backend `q` param → messageContains ILIKE.
    // Trim so trailing spaces don't surprise the user with no results.
    const q = els.search.value.trim();
    if (q)                         p.set('q',        q);
    if (els.from.value)            p.set('from',     String(new Date(els.from.value).getTime()));
    if (els.to.value)              p.set('to',       String(new Date(els.to.value).getTime()));
    p.set('sortBy',  state.sortBy);
    p.set('sortDir', state.sortDir);
    for (const pf of payloadFilters) {
        if (pf.key.trim() && pf.value.trim()) {
            p.set('payload.' + pf.key.trim(), pf.value.trim());
        }
    }
    return p.toString();
}

/** Persist filter values to localStorage so reloads keep the view. */
export function save() {
    // The pickers persist their own selection inside their mount fns,
    // so we don't push anything for them here.
    PREF_STATUS.set(els.status.value);
    PREF_SEARCH.set(els.search.value);
    PREF_PAYLOAD.set(payloadFilters);
}

/** Reset the visible inputs and persisted values. */
export function clear() {
    els.status.value   = '';
    els.search.value   = '';
    els.from.value     = '';
    els.to.value       = '';
    payloadFilters     = [];
    for (const ctrl of Object.values(pickers)) ctrl?.clear?.();
    renderPayloadEntries();
    save();
}

/**
 * Client-side predicate, used to decide whether an SSE-pushed event still
 * matches the active filters before adding it to the table. Backend already
 * filters at query time, but SSE delivers everything matching the original
 * stream, and we may have changed filters since.
 */
export function matches(ev) {
    for (const ctrl of Object.values(pickers)) {
        if (ctrl?.matches && !ctrl.matches(ev)) return false;
    }
    const s = els.status.value;
    if (s && ev.status !== s) return false;
    // Free-text search — case-insensitive substring on the message.
    // Mirrors the backend's `message ILIKE '%q%'` so an SSE-pushed
    // event that doesn't match the current search box drops out.
    const q = els.search.value.trim().toLowerCase();
    if (q && !(typeof ev.message === 'string' && ev.message.toLowerCase().includes(q))) return false;
    const ts = ev.receivedAt || ev.timestamp;
    if (els.from.value) {
        const fromMs = new Date(els.from.value).getTime();
        if (ts < fromMs) return false;
    }
    if (els.to.value) {
        const toMs = new Date(els.to.value).getTime();
        if (ts > toMs) return false;
    }
    for (const pf of payloadFilters) {
        if (pf.key.trim() && pf.value.trim()) {
            const v = ev.payload?.[pf.key.trim()];
            if (String(v) !== pf.value.trim()) return false;
        }
    }
    return true;
}

// ── Payload entries renderer ───────────────────────────────────────────────
function renderPayloadEntries() {
    els.payloadList.innerHTML = '';
    payloadFilters.forEach((pf, i) => {
        const row = document.createElement('div');
        row.className = 'tk-popover__row';
        row.innerHTML = `
            <input type="text" placeholder="key"   value="${escapeHtml(pf.key)}"   data-idx="${i}" data-field="key" />
            <span style="color:var(--text-dim);">=</span>
            <input type="text" placeholder="value" value="${escapeHtml(pf.value)}" data-idx="${i}" data-field="value" />
            <button class="tk-popover__remove" data-idx="${i}" aria-label="Remove">&times;</button>`;
        row.querySelector('.tk-popover__remove').addEventListener('click', () => {
            payloadFilters.splice(i, 1);
            renderPayloadEntries();
            bus.emit('filters:changed', { source: 'payload' });
        });
        row.querySelectorAll('input').forEach(inp => {
            inp.addEventListener('input', () => {
                payloadFilters[Number(inp.dataset.idx)][inp.dataset.field] = inp.value;
                updatePayloadCount();
                // Debounced upstream — the bus consumer in main.js
                // collapses fast keystrokes into one fetch.
                bus.emit('filters:changed', { source: 'payload' });
            });
        });
        els.payloadList.appendChild(row);
    });
    updatePayloadCount();
}

function updatePayloadCount() {
    const n = payloadFilters.filter(pf => pf.key.trim() && pf.value.trim()).length;
    els.payloadCount.textContent = n > 0 ? `(${n})` : '';
}

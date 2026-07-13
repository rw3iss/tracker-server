/**
 * main.js — entry point. Wires the modules together and owns the connect /
 * reconnect lifecycle. Each subsystem (filters, table, summary, …) does its
 * own thing — main.js only sequences.
 *
 * Boot sequence:
 *   1. Resolve endpoint + routePrefix from URL/localStorage.
 *   2. Mount each subsystem on its DOM root.
 *   3. Wire global handlers (Connect button, Apply, Clear, keyboard).
 *   4. Connect to the server (initial load → SSE → poll fallback).
 */

import { Pref } from './prefs.js';
import {
    state, bus,
    setEndpoint, setEvents, upsertEvent, clearEvents, setLiveFilter,
    setDeepLinkedEvent, markDeepLinkResolved, setSelected,
} from './state.js';

const PREF_ENDPOINT = new Pref('connection:endpoint', '');
import { connect, fetchEvent } from './api.js';
import { mountFilters } from './filters.js';
import { mountColumnPicker } from './columns.js';
import { mountTable } from './table.js';
import { mountDetail } from './detail.js';
import { mountSummary } from './summary/index.js';
import { mountThemeToggle } from './theme.js';
import { bootURLSync } from './url-sync.js';
import { updateURLParams } from './url-params.js';
import { checkForUpdate, showCurrentChangelog } from './auto-update.js';

// Run before any other subsystem mounts: if the build version differs
// from the one we last saw, this clears localStorage + sessionStorage,
// re-stamps the version, and shows the post-update modal. Mounting any
// subsystem first would just give it state we're about to wipe.
checkForUpdate();

const params = new URLSearchParams(window.location.search);

// ── Endpoint + prefix resolution ──────────────────────────────────────────
const initialEndpoint = (
    params.get('endpoint')
    || PREF_ENDPOINT.get()
    || window.location.origin
).replace(/\/$/, '');

// Resolution order, highest priority first:
//   1. ?prefix=… URL param      — manual operator override
//   2. window.__TRACKER_DASHBOARD_CONFIG__.apiPrefix  — server-injected
//      truth (TrackerDashboardController substitutes {{API_PREFIX}}
//      from the consumer's ROUTE_PREFIX env at request time)
//   3. '/api'                   — backwards-compat default for older
//                                 deployments serving an HTML bundle
//                                 that pre-dates the injection.
const routePrefix = (() => {
    const raw = params.get('prefix');
    if (raw) return raw.startsWith('/') ? raw : '/' + raw;
    const cfg = (typeof window !== 'undefined' && window.__TRACKER_DASHBOARD_CONFIG__) || null;
    const fromServer = cfg && typeof cfg.apiPrefix === 'string' ? cfg.apiPrefix.trim() : '';
    // The server may legitimately inject `''` (root-mounted API). Any
    // non-empty value is taken as truth; only fall back when nothing
    // was injected at all (raw substitution leaves the placeholder).
    if (cfg && fromServer !== '{{API_PREFIX}}') {
        if (fromServer === '') return '';
        return fromServer.startsWith('/') ? fromServer : '/' + fromServer;
    }
    return '/api';
})();

setEndpoint(initialEndpoint, routePrefix);

const epInput   = document.getElementById('endpoint-input');
const sseStatus = document.getElementById('sse-status');
const btnConnect = document.getElementById('btn-connect');
const btnApply   = document.getElementById('btn-apply');
const btnClear   = document.getElementById('btn-clear');
const chkLive    = document.getElementById('chk-live-filter');

epInput.value = state.endpoint;

// ── Mount subsystems ──────────────────────────────────────────────────────
mountThemeToggle();                  // does its own DOM lookup, no return needed
const filters = mountFilters();
mountColumnPicker();
mountTable(() => doConnect());     // server-sort change → reconnect
mountDetail();
mountSummary();

// URL ↔ state bridge. Reads the current URL once and pushes any param it
// recognises into the matching filter (URL beats localStorage per-key).
// From here on, any filter change is mirrored back into the URL. Runs
// AFTER mounts so all the picker/input refs are live, and BEFORE
// doConnect() so the initial fetch uses the URL-resolved state.
bootURLSync({ filters });

// ── Connect lifecycle ─────────────────────────────────────────────────────
function doConnect() {
    setEvents([]);
    connect({
        endpoint:    state.endpoint,
        routePrefix: state.routePrefix,
        queryString: filters.buildQueryString(),
        hooks: {
            onLoad:   events => setEvents(events),
            onEvent:  ev => { if (filters.matches(ev)) upsertEvent(ev); },
            onStatus: setStatus,
        },
    });
}

function setStatus(stateName) {
    sseStatus.className = `tk-status ${stateName}`;
    if (stateName === 'ok')   sseStatus.textContent = '● SSE connected';
    if (stateName === 'poll') sseStatus.textContent = '⟳ polling (SSE unavailable)';
    if (stateName === 'err')  sseStatus.textContent = '✕ disconnected';
}

// ── Global handlers ───────────────────────────────────────────────────────
btnConnect.addEventListener('click', () => {
    const next = (epInput.value.trim() || window.location.origin).replace(/\/$/, '');
    setEndpoint(next, state.routePrefix);
    PREF_ENDPOINT.set(next);
    doConnect();
});

btnApply.addEventListener('click', () => {
    filters.save();
    doConnect();
});

// Programmatic filter changes (e.g. from a Summary chart click) come in
// via the bus rather than calling doConnect() directly — keeps callers
// decoupled from main.js.
bus.on('filters:apply', () => doConnect());

// ── Live-filter toggle ────────────────────────────────────────────────────
//
// When on, every filter change re-runs the query. The pickers / inputs
// emit 'filters:changed' on edit; we debounce to one fetch per ~250ms
// so a fast multi-select doesn't fire N requests.
//
// When off, the bus event still fires but nothing reacts — Apply is the
// only trigger, matching the historical UX.

let liveFilterTimer = null;
function scheduleLiveFetch() {
    if (!state.liveFilter) return;
    if (liveFilterTimer) clearTimeout(liveFilterTimer);
    liveFilterTimer = setTimeout(() => {
        liveFilterTimer = null;
        filters.save();
        doConnect();
    }, 250);
}
bus.on('filters:changed', scheduleLiveFetch);

function applyLiveModeUi() {
    if (chkLive)   chkLive.checked = state.liveFilter;
    if (btnApply)  btnApply.hidden = state.liveFilter;
}
applyLiveModeUi();
bus.on('liveFilter:changed', applyLiveModeUi);

if (chkLive) {
    chkLive.addEventListener('change', () => {
        setLiveFilter(chkLive.checked);
        // Flipping live ON → run an immediate fetch with the current
        // toolbar state so the user sees the in-flight changes
        // straight away rather than waiting for the next edit.
        if (state.liveFilter) {
            filters.save();
            doConnect();
        }
    });
}

btnClear.addEventListener('click', () => clearEvents());

// "Changes" button — manual entry into the same modal the auto-updater
// fires after a version-mismatch wipe. View-only here: doesn't touch
// storage, doesn't reload, dismissible normally.
document.getElementById('btn-changelog')?.addEventListener('click', () => showCurrentChangelog());

// Keyboard shortcuts
document.addEventListener('keydown', e => {
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (e.key === 'r' || e.key === 'R') doConnect();
    if (e.key === 'f' || e.key === 'F') document.getElementById('btn-appids-toggle')?.click();
});

// ── Deep-link via ?event_id ───────────────────────────────────────────────
//
// The dashboard supports permalink-style URLs like
// `…/dashboard?event_id=c4f9a0e8-…`. On load we fetch the event
// directly via `GET /api/events/:id` so the detail panel opens even
// when the event isn't in the current results window. After the
// first events:changed pass we also try to highlight the matching
// row in the table, then mark the deep-link resolved so subsequent
// SSE / live-filter renders don't keep re-selecting it.
//
// Row clicks update the URL via `history.replaceState` so the address
// bar reflects the currently-selected event — share-and-paste works.

const requestedEventId = params.get('event_id');

if (requestedEventId) {
    fetchEvent(state.endpoint, state.routePrefix, requestedEventId)
        .then((event) => {
            setDeepLinkedEvent({ id: requestedEventId, event });
            // Detail panel listens for selection changes — push the
            // id so the panel opens. detail.js falls back to the
            // deep-linked payload when the event isn't in state.events.
            setSelected(requestedEventId);
        })
        .catch((err) => {
            const error = err.message === 'not-found'
                ? 'Event not found.'
                : `Lookup failed: ${err.message}`;
            setDeepLinkedEvent({ id: requestedEventId, error });
            setSelected(requestedEventId);
        });
}

// First events:changed pass — if the deep-linked id is in the loaded
// set, highlight that row. After this fires once we set the resolved
// flag so later renders (live filter, SSE) don't keep re-selecting.
const offFirstEvents = bus.on('events:changed', () => {
    if (!requestedEventId || state.deepLinkResolved) return;
    const found = state.events.some((e) => e.id === requestedEventId);
    if (found) setSelected(requestedEventId);
    markDeepLinkResolved();
    offFirstEvents();
});

// Selection ↔ URL sync — clicks on the table emit selection:changed,
// we mirror the id into the address bar via the shared URL helper
// (debounced replaceState, no back-button bloat). Closing the panel
// clears it.
bus.on('selection:changed', (id) => {
    updateURLParams({ event_id: id || null });
    if (!id) setDeepLinkedEvent(null);
});

// ── Boot ──────────────────────────────────────────────────────────────────
doConnect();

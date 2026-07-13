/**
 * api.js — HTTP / SSE / polling client for the tracker server.
 *
 * Owns the network side. Exposes one entrypoint, `connect(endpoint, prefix,
 * filters, hooks)`, that sequences:
 *   1. Initial GET /events (load whatever is already stored).
 *   2. SSE GET /events/stream — preferred for live updates.
 *   3. Polling GET /events every 5s — automatic fallback if SSE never opens
 *      or errors out. SSE is retried every 30s while polling.
 *
 * Hooks let the caller plug in side effects (status indicator, event
 * reception) without us touching DOM or shared state directly.
 */

let activeSSE   = null;
let pollTimer   = null;
let pollMode    = false;
let sseRetry    = null;

/**
 * Open / re-open a connection to the tracker server.
 * Always tears down any previous connection first, so calling repeatedly
 * (e.g. on filter changes) is safe.
 *
 * @param {object} cfg
 * @param {string} cfg.endpoint    Server origin, no trailing slash.
 * @param {string} cfg.routePrefix API prefix, leading slash (e.g. '/api').
 * @param {string} cfg.queryString URL-encoded filters (already built).
 * @param {object} cfg.hooks
 * @param {(events: any[]) => void} cfg.hooks.onLoad     Initial bulk load.
 * @param {(event: any) => void}    cfg.hooks.onEvent    Single event from SSE.
 * @param {(state: 'ok'|'poll'|'err') => void} cfg.hooks.onStatus
 */
export function connect({ endpoint, routePrefix, queryString, hooks }) {
    teardown();

    loadInitial(endpoint, routePrefix, queryString)
        .then(events => hooks.onLoad(events))
        .catch(() => { /* non-fatal — SSE/poll will fill in */ });

    startSSE(endpoint, routePrefix, queryString, hooks);
}

/**
 * Fetch a single event by id. Returns the event on success, throws
 * `Error('not-found')` on 404 (so the deep-link caller can show a
 * "not found" state in the detail pane rather than a generic message),
 * or any other error verbatim.
 */
export async function fetchEvent(endpoint, routePrefix, id) {
    const url = `${endpoint}${routePrefix}/events/${encodeURIComponent(id)}`;
    const res = await fetch(url);
    if (res.status === 404) throw new Error('not-found');
    if (!res.ok)             throw new Error(`HTTP ${res.status}`);
    return res.json();
}

/** Update an event's status via PATCH /events/:id/status. */
export async function updateStatus(endpoint, routePrefix, id, status) {
    const url = `${endpoint}${routePrefix}/events/${id}/status`;
    const res = await fetch(url, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// ── Internals ──────────────────────────────────────────────────────────────

async function loadInitial(endpoint, prefix, qs) {
    const url = `${endpoint}${prefix}/events${qs ? '?' + qs : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

function startSSE(endpoint, prefix, qs, hooks) {
    if (activeSSE) { activeSSE.close(); activeSSE = null; }
    stopPolling();

    const url = `${endpoint}${prefix}/events/stream${qs ? '?' + qs : ''}`;
    let opened = false;
    const openTimeout = setTimeout(() => {
        if (!opened) { closeSSE(); fallbackToPolling(endpoint, prefix, qs, hooks); }
    }, 5000);

    let source;
    try { source = new EventSource(url); }
    catch { clearTimeout(openTimeout); fallbackToPolling(endpoint, prefix, qs, hooks); return; }

    activeSSE = source;
    source.onopen = () => {
        opened = true;
        clearTimeout(openTimeout);
        hooks.onStatus('ok');
    };
    source.onmessage = ev => {
        opened = true;
        clearTimeout(openTimeout);
        try { hooks.onEvent(JSON.parse(ev.data)); } catch { /* malformed */ }
    };
    source.onerror = () => {
        clearTimeout(openTimeout);
        closeSSE();
        fallbackToPolling(endpoint, prefix, qs, hooks);
    };
}

function fallbackToPolling(endpoint, prefix, qs, hooks) {
    pollMode = true;
    hooks.onStatus('poll');
    schedulePoll(endpoint, prefix, qs, hooks);

    // Periodically retry SSE so we recover from transient outages.
    if (sseRetry) clearTimeout(sseRetry);
    sseRetry = setTimeout(() => {
        if (pollMode) startSSE(endpoint, prefix, qs, hooks);
    }, 30_000);
}

function schedulePoll(endpoint, prefix, qs, hooks) {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
        try {
            const events = await loadInitial(endpoint, prefix, qs);
            hooks.onLoad(events);
        } catch {
            hooks.onStatus('err');
        }
        if (pollMode) schedulePoll(endpoint, prefix, qs, hooks);
    }, 5_000);
}

function stopPolling() {
    pollMode = false;
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
}

function closeSSE() {
    if (activeSSE) { activeSSE.close(); activeSSE = null; }
}

function teardown() {
    closeSSE();
    stopPolling();
    if (sseRetry) { clearTimeout(sseRetry); sseRetry = null; }
}

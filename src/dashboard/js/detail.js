/**
 * detail.js — slide-up panel that shows the JSON payload of a selected
 * event, plus a status-update control. Resizable via the header drag.
 *
 * Owns the detail panel only — it doesn't know about filters, columns, or
 * the table. It listens for selection changes and renders accordingly.
 */

import { Pref } from './prefs.js';
import { state, bus, setSelected, upsertEvent } from './state.js';
import { updateStatus } from './api.js';
import { renderPretty } from './detail-pretty.js';
import { flashCopySuccess } from './clipboard.js';

const PREF_DETAIL_HEIGHT = new Pref('detail:height', null);
/** Persisted between sessions so the panel re-opens in the user's
 *  preferred view mode. */
const PREF_DETAIL_PRETTY = new Pref('detail:pretty', false);

let els = {};
/** Cached event currently displayed in the panel — used by the Pretty
 *  toggle to re-render in the new mode without a full reselect. */
let currentEv = null;

export function mountDetail() {
    els = {
        panel:      document.getElementById('event-detail'),
        header:     document.getElementById('detail-header'),
        json:       document.getElementById('detail-json'),
        pretty:     document.getElementById('detail-pretty'),
        btnPretty:  document.getElementById('btn-toggle-pretty'),
        statusSel:  document.getElementById('detail-status-sel'),
        btnUpdate:  document.getElementById('btn-update-status'),
        btnCopy:    document.getElementById('btn-copy-detail'),
        btnCopyApi: document.getElementById('btn-copy-api-link'),
        btnClose:   document.getElementById('btn-close-detail'),
    };

    // Restore the user's last view-mode preference.
    syncPrettyToggle(PREF_DETAIL_PRETTY.get());

    // Persisted height. We set `height` (not `maxHeight`) so the panel
    // claims a definite size in the flex column — which makes the table
    // shrink to fit beside it instead of being covered by it.
    const h = PREF_DETAIL_HEIGHT.get();
    if (h) els.panel.style.height = h + 'px';

    bus.on('selection:changed', id => {
        if (!id) return hide();
        // Prefer the in-table row's data — it's freshest. Fall back to
        // the deep-link payload (URL `?event_id=…`) so permalinks
        // work even when the event isn't in the current results window.
        const ev = state.events.find(e => e.id === id);
        if (ev) return show(ev);
        const dl = state.deepLinkedEvent;
        if (dl && dl.id === id) {
            if (dl.event) return show(dl.event);
            if (dl.error) return showError(id, dl.error);
        }
        // Selected an id we know nothing about — close.
        hide();
    });

    // If the deep-link result lands AFTER selection:changed (the
    // common case — fetch is async), re-render once it's available.
    bus.on('deepLink:changed', (payload) => {
        if (!payload) return;
        if (state.selectedId !== payload.id) return;
        if (payload.event) show(payload.event);
        else if (payload.error) showError(payload.id, payload.error);
    });

    els.btnClose.addEventListener('click', () => setSelected(null));

    els.btnPretty.addEventListener('click', () => {
        const next = !PREF_DETAIL_PRETTY.get();
        PREF_DETAIL_PRETTY.set(next);
        syncPrettyToggle(next);
        // Re-render the currently-shown event in the new mode (if any).
        if (currentEv) renderForCurrentMode(currentEv);
    });

    // Whole-event copy. Icon button next to the title — the canonical
    // JSON form so users can paste into anywhere (issue tracker, Slack,
    // jq pipeline). Brief checkmark swap on success, matching the
    // per-field copy buttons in pretty mode for visual consistency.
    els.btnCopy.addEventListener('click', () => {
        const text = currentEv ? JSON.stringify(currentEv, null, 2) : els.json.textContent;
        navigator.clipboard.writeText(text).then(() => {
            flashCopySuccess(els.btnCopy);
        }).catch(() => {});
    });

    // Copy the absolute API URL for this event — handy for sharing or
    // pasting into curl/Postman. Builds the URL from the same `endpoint`
    // + `routePrefix` the dashboard's connect() uses, so it always
    // matches what the consumer is actually serving on. The id comes
    // from state.selectedId so the button works whether the panel is
    // showing a deep-linked event, a row click, or an SSE-pushed update.
    els.btnCopyApi.addEventListener('click', () => {
        const id = state.selectedId;
        if (!id) return;
        const url = `${state.endpoint}${state.routePrefix}/events/${encodeURIComponent(id)}`;
        navigator.clipboard.writeText(url).then(() => {
            flashCopySuccess(els.btnCopyApi);
        }).catch(() => {});
    });

    els.btnUpdate.addEventListener('click', async () => {
        const id = state.selectedId;
        if (!id) return;
        try {
            await updateStatus(state.endpoint, state.routePrefix, id, els.statusSel.value);
            const ev = state.events.find(e => e.id === id);
            if (ev) {
                upsertEvent({ ...ev, status: els.statusSel.value });
            }
            setSelected(null);
        } catch (err) {
            alert('Failed to update status: ' + err.message);
        }
    });

    initResize();

    // Esc to close
    document.addEventListener('keydown', e => {
        const tag = document.activeElement?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
        if (e.key === 'Escape') setSelected(null);
    });
}

function show(ev) {
    els.statusSel.disabled = false;
    els.btnUpdate.disabled = false;
    els.statusSel.value    = ev.status || 'new';
    currentEv              = ev;
    renderForCurrentMode(ev);
    els.panel.hidden = false;
}

/**
 * Render the panel for a deep-linked event id we couldn't resolve —
 * 404 from the server, network error, malformed response, etc. The
 * status select + Update button are disabled because there's no
 * event to mutate. Pretty mode is force-disabled here because there's
 * no structured event to format — just an explanatory message.
 */
function showError(id, message) {
    els.statusSel.disabled = true;
    els.btnUpdate.disabled = true;
    currentEv = null;
    els.json.textContent =
        `// Could not load event ${id}\n` +
        `// ${message}\n` +
        `//\n` +
        `// The id may have been deleted, or the server is unreachable.\n` +
        `// Close this panel to clear the event_id from the URL.`;
    els.json.hidden   = false;
    els.pretty.hidden = true;
    els.panel.hidden  = false;
}

function hide() {
    currentEv = null;
    els.panel.hidden = true;
}

/** Toggle view mode visibility + button aria-pressed. Doesn't render
 *  anything itself — `renderForCurrentMode` handles content. */
function syncPrettyToggle(enabled) {
    if (els.btnPretty) els.btnPretty.setAttribute('aria-pressed', String(Boolean(enabled)));
    if (els.json)      els.json.hidden   =  Boolean(enabled);
    if (els.pretty)    els.pretty.hidden = !Boolean(enabled);
}

/** Render `ev` into whichever target is currently visible. Called by
 *  show() and by the Pretty toggle. */
function renderForCurrentMode(ev) {
    const pretty = PREF_DETAIL_PRETTY.get();
    syncPrettyToggle(pretty);
    if (pretty) renderPretty(els.pretty, ev);
    else        els.json.textContent = JSON.stringify(ev, null, 2);
}


function initResize() {
    let dragging = false;
    let startY   = 0;
    let startH   = 0;

    els.header.addEventListener('mousedown', e => {
        dragging = true;
        startY   = e.clientY;
        startH   = els.panel.offsetHeight;
        e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
        if (!dragging) return;
        const delta = startY - e.clientY;
        // Clamp to [120 px, 75% of viewport]. Matches the
        // `max-height: 75vh` ceiling in dashboard.css so the visible
        // size never exceeds what CSS will render anyway. Drag past
        // the cap → height pins at the cap, cursor keeps moving.
        const cap   = Math.floor(window.innerHeight * 0.75);
        const next  = Math.max(120, Math.min(cap, startH + delta));
        els.panel.style.height = next + 'px';
    });
    document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        PREF_DETAIL_HEIGHT.set(els.panel.offsetHeight);
    });
}

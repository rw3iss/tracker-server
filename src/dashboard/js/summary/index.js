/**
 * summary/index.js — TrackingSummary controller.
 *
 * Owns the Summary panel: open/close, group-by toggle (type | appId),
 * view toggle (pie | bar | line), and the chart canvas grid.
 *
 * Lazy-mount design
 * ─────────────────
 * The `<section id="summary-panel">` ships empty and `hidden`. Its inner
 * content (group/view button bars, charts host, empty-state) gets rendered
 * into the section the first time the user opens the panel, and torn down
 * when they close it. That means:
 *
 *   • No padding / border leakage from a "collapsed-but-still-in-DOM"
 *     element when the toggle is off.
 *   • `render()` never runs while the panel is hidden — the early
 *     return on `state.summaryOpen` plus the absence of a `chartsHost`
 *     element guarantee no group/chart work happens.
 *   • Chart.js instances get destroyed on close, freeing canvas + GC.
 *
 * SOLID-ish split:
 *   • grouping.js  → pure data shaping (cached).
 *   • charts.js    → presentational Chart.js wrappers.
 *   • this file    → glue: read/write state, react to bus events, drive
 *                     the right chart builder for the current view.
 */

import { state, bus, setSummary } from '../state.js';
import { applyFilters } from '../filters.js';
import { groupEvents } from './grouping.js';
import { renderPies, renderBar, renderLine } from './charts.js';

/**
 * Click handler shared by every chart type. Translates the (outer, inner)
 * pair from the click into a `{ appId, type }` filter partial based on
 * the current group mode, then calls into the toolbar's apply pipeline.
 *
 * Placeholder values produced by `groupEvents` (`'(unknown)'` for events
 * with no appId) collapse to an empty filter so the user doesn't get a
 * fruitless search for the literal string.
 */
function selectionToFilter(outer, inner, group) {
    const partial = group === 'type'
        ? { type: outer, appId: inner }
        : { appId: outer, type: inner };
    if (partial.appId === '(unknown)') partial.appId = '';
    if (partial.type  === '(unknown)') partial.type  = '';
    return partial;
}

const DEBOUNCE_MS = 200;

/** Inner-panel template. Rendered into #summary-panel on open, removed
 *  on close. Kept here (rather than in HTML) so close() can tear it
 *  down completely. */
const INNER_TEMPLATE = `
    <div class="tk-summary__inner">
        <div class="tk-summary__bar">
            <div class="tk-summary__title">
                Summary <strong id="summary-count">0</strong>
                <span class="tk-summary__group-label">
                    Group by:
                    <span class="tk-btn-group" role="group" aria-label="Group by">
                        <button class="tk-btn tk-btn--toggle" data-group="type"  aria-pressed="true">Type</button>
                        <button class="tk-btn tk-btn--toggle" data-group="appId" aria-pressed="false">App</button>
                    </span>
                </span>
            </div>
            <span class="tk-btn-group" role="group" aria-label="View as">
                <button class="tk-btn tk-btn--toggle" data-view="pie"  aria-pressed="true">Pie</button>
                <button class="tk-btn tk-btn--toggle" data-view="bar"  aria-pressed="false">Bar</button>
                <button class="tk-btn tk-btn--toggle" data-view="line" aria-pressed="false">Line</button>
            </span>
        </div>
        <div id="summary-charts" class="tk-summary__charts is-pie"></div>
        <div id="summary-empty" class="tk-summary__empty" hidden>
            No events to summarise yet.
        </div>
    </div>`;

// Always-on references — exist whether or not the panel is open.
const outer = { panel: null, toggleBtn: null };
// On-demand references — null while the panel is closed.
let inner = null;
let destroyCharts = () => {};
let pendingRender = null;

export function mountSummary() {
    outer.panel     = document.getElementById('summary-panel');
    outer.toggleBtn = document.getElementById('btn-toggle-summary');

    syncToggleAria();

    // Single source of truth: the toggle button + keyboard + URL-sync
    // all just flip `state.summaryOpen`. The bus listener below reacts
    // by opening or closing the panel — keeps the open/close path
    // identical regardless of who initiated the change.
    outer.toggleBtn.addEventListener('click', () => setSummary({ open: !state.summaryOpen }));

    // Initial open if the user had it open last session OR URL says so
    // (URL-sync runs after mount, so this `if` only catches the saved
    // case; the URL case is caught by the `summary:changed` listener
    // below when bootURLSync writes the state).
    if (state.summaryOpen) openPanel();

    bus.on('summary:changed', () => {
        // Reconcile the panel's mounted/unmounted state with the new
        // `summaryOpen` value. No-op when they already agree.
        if (state.summaryOpen  && outer.panel.hidden)  openPanel();
        if (!state.summaryOpen && !outer.panel.hidden) closePanel();
        syncToggleAria();
        syncInnerToggles();
        scheduleRender();
    });
    bus.on('events:changed', () => scheduleRender());
    // Re-render when the theme flips so chart text / borders pick up
    // the new CSS-variable values (Chart.js reads them at construction).
    bus.on('theme:changed',  () => scheduleRender());

    // Keyboard shortcut — same as clicking the toggle.
    document.addEventListener('keydown', e => {
        const tag = document.activeElement?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
        if (e.key === 's' || e.key === 'S') setSummary({ open: !state.summaryOpen });
    });
}

// ── Panel open/close ──────────────────────────────────────────────────────
function openPanel() {
    if (!inner) mountInner();
    outer.panel.hidden = false;
    outer.panel.setAttribute('aria-hidden', 'false');
    syncToggleAria();
    syncInnerToggles();
    scheduleRender();
}

function closePanel() {
    destroyCharts();
    destroyCharts = () => {};
    if (pendingRender) { clearTimeout(pendingRender); pendingRender = null; }
    outer.panel.hidden = true;
    outer.panel.setAttribute('aria-hidden', 'true');
    syncToggleAria();
    unmountInner();
}

/** Render the inner template into the panel + cache element refs and
 *  wire the controls inside it. Called once per open. */
function mountInner() {
    outer.panel.innerHTML = INNER_TEMPLATE;
    inner = {
        chartsHost: outer.panel.querySelector('#summary-charts'),
        emptyMsg:   outer.panel.querySelector('#summary-empty'),
        countLabel: outer.panel.querySelector('#summary-count'),
        groupBtns:  outer.panel.querySelectorAll('[data-group]'),
        viewBtns:   outer.panel.querySelectorAll('[data-view]'),
    };
    inner.groupBtns.forEach(btn => {
        btn.addEventListener('click', () => setSummary({ group: btn.dataset.group }));
    });
    inner.viewBtns.forEach(btn => {
        btn.addEventListener('click', () => setSummary({ view: btn.dataset.view }));
    });
}

/** Tear the inner content out of the DOM. Listener removal is implicit
 *  (the elements they were bound to no longer exist). */
function unmountInner() {
    if (!inner) return;
    outer.panel.innerHTML = '';
    inner = null;
}

// ── Toggle aria sync ──────────────────────────────────────────────────────
function syncToggleAria() {
    outer.toggleBtn.setAttribute('aria-pressed', String(state.summaryOpen));
}

/** Sync the group/view button `aria-pressed` + the chartsHost view class.
 *  No-op when the panel is closed (inner is null). */
function syncInnerToggles() {
    if (!inner) return;
    inner.groupBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.group === state.summaryGroup)));
    inner.viewBtns.forEach(b  => b.setAttribute('aria-pressed', String(b.dataset.view  === state.summaryView)));
    inner.chartsHost.classList.remove('is-pie', 'is-bar', 'is-line');
    inner.chartsHost.classList.add('is-' + state.summaryView);
}

// ── Render pipeline ───────────────────────────────────────────────────────
function scheduleRender() {
    // Two guards — `summaryOpen` is the source of truth, `inner` is the
    // DOM check. Both must be true for any work to happen.
    if (!state.summaryOpen || !inner) return;
    if (pendingRender) clearTimeout(pendingRender);
    pendingRender = setTimeout(render, DEBOUNCE_MS);
}

function render() {
    pendingRender = null;
    if (!state.summaryOpen || !inner) return;

    destroyCharts();
    inner.chartsHost.innerHTML = '';
    inner.countLabel.textContent = state.events.length;

    if (!state.events.length) {
        inner.emptyMsg.hidden = false;
        return;
    }
    inner.emptyMsg.hidden = true;

    const grouped = groupEvents(state.events, state.summaryGroup);
    const onSelect = (o, i) => applyFilters(selectionToFilter(o, i, state.summaryGroup));

    if (state.summaryView === 'pie') {
        destroyCharts = renderPies(inner.chartsHost, grouped, onSelect);
    } else if (state.summaryView === 'bar') {
        destroyCharts = renderBar(inner.chartsHost, grouped, onSelect);
    } else if (state.summaryView === 'line') {
        // Line view shares the bar/pie grouping shape — X = outer keys,
        // one line per inner key. Reusing the same data avoids a separate
        // time-bucketing path that didn't match the user's mental model.
        destroyCharts = renderLine(inner.chartsHost, grouped, onSelect);
    }
}

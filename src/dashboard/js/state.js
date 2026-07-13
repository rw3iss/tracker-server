/**
 * state.js — single source of truth for dashboard state, plus a tiny pub-sub
 * bus so modules can react to changes without importing each other directly.
 *
 * Topics:
 *   'events:changed'  — fired after the events array is replaced or extended.
 *   'filters:changed' — fired when filter values are modified.
 *   'columns:changed' — fired when the visible columns list changes.
 *   'sort:changed'    — fired when sort key / direction changes.
 *
 * Modules either:
 *   • read from `state.*` (synchronously),
 *   • call a setter / mutator below to update + emit,
 *   • or subscribe via `bus.on(topic, handler)`.
 *
 * No module mutates state directly — that keeps the data flow predictable
 * and means we never have to chase down a stray writer.
 */

import { Pref } from './prefs.js';

// ── Preferences (declare defaults here, share with consumers) ──────────────
export const PREFS = {
    sortBy:         new Pref('table:sortBy',         'receivedAt'),
    sortDir:        new Pref('table:sortDir',        'desc'),
    visibleColumns: new Pref('table:visibleColumns', null),               // null → registry defaults
    columnWidths:   new Pref('table:columnWidths',   {},
        { validate: v => v && typeof v === 'object' && !Array.isArray(v) }),
    summaryOpen:    new Pref('summary:open',         false),
    summaryGroup:   new Pref('summary:group',        'type'),
    summaryView:    new Pref('summary:view',         'pie'),

    // When true, filter changes auto-trigger a re-fetch — no Apply
    // click required. Default off so first-time visitors get the
    // explicit-Apply UX they've seen on every other dashboard. Toggle
    // via the 'Live filter' checkbox in the stats bar.
    liveFilter:     new Pref('toolbar:liveFilter',   false),
};

// ── Shared in-memory state ─────────────────────────────────────────────────
export const state = {
    /** @type {import('./types').StoredTrackerEvent[]} */
    events: [],

    selectedId: null,

    // Sort
    sortBy:  PREFS.sortBy.get(),
    sortDir: PREFS.sortDir.get(),

    // Connection
    endpoint:    '',
    routePrefix: '/api',

    // Visible columns (array of column keys defined in columns.js).
    visibleColumns: PREFS.visibleColumns.get(),

    // Summary panel
    summaryOpen:  PREFS.summaryOpen.get(),
    summaryGroup: PREFS.summaryGroup.get(),
    summaryView:  PREFS.summaryView.get(),

    // Live-filter toggle.
    liveFilter:   PREFS.liveFilter.get(),

    /**
     * One-shot deep-link payload — the event resolved from the URL's
     * `?event_id=…` parameter. Holds either the full event, or a small
     * `{ error }` marker when the lookup failed (404, network, …) so
     * the detail pane can render a "not found" state. Cleared when
     * the user dismisses the panel.
     *
     * @type {{ event?: any, error?: string, id: string } | null}
     */
    deepLinkedEvent:  null,

    /**
     * Set true after the first events:changed pass that consumed a
     * deep-link — guards against repeatedly re-selecting the row on
     * later renders (live filter, SSE updates).
     */
    deepLinkResolved: false,
};

// ── Pub-sub bus ────────────────────────────────────────────────────────────
const target = new EventTarget();

export const bus = {
    on(topic, handler) {
        const wrapped = e => handler(e.detail);
        target.addEventListener(topic, wrapped);
        return () => target.removeEventListener(topic, wrapped);
    },
    emit(topic, detail) {
        target.dispatchEvent(new CustomEvent(topic, { detail }));
    },
};

// ── Mutators (the only place state is written) ─────────────────────────────

/** Replace the entire events array. Used on initial load + reconnect. */
export function setEvents(events) {
    state.events = events.slice();
    sortEvents();
    bus.emit('events:changed', state.events);
}

/** Insert or update a single event (matched by id). */
export function upsertEvent(event) {
    const idx = state.events.findIndex(e => e.id === event.id);
    if (idx >= 0) state.events[idx] = event;
    else          state.events.push(event);
    sortEvents();
    bus.emit('events:changed', state.events);
}

export function clearEvents() {
    state.events = [];
    state.selectedId = null;
    bus.emit('events:changed', state.events);
}

export function setSelected(id) {
    state.selectedId = id;
    bus.emit('selection:changed', id);
}

export function setSort(sortBy, sortDir) {
    state.sortBy  = sortBy;
    state.sortDir = sortDir;
    PREFS.sortBy.set(sortBy);
    PREFS.sortDir.set(sortDir);
    sortEvents();
    bus.emit('sort:changed', { sortBy, sortDir });
    bus.emit('events:changed', state.events);
}

export function setVisibleColumns(keys) {
    state.visibleColumns = keys;
    PREFS.visibleColumns.set(keys);
    bus.emit('columns:changed', keys);
}

/**
 * Stash the deep-link result so `detail.js` can render it even when
 * the event isn't part of the loaded results window. Pass `null` to
 * clear (called when the panel closes).
 */
export function setDeepLinkedEvent(payload) {
    state.deepLinkedEvent = payload;
    state.deepLinkResolved = false;
    bus.emit('deepLink:changed', payload);
}

/** Mark the deep-link "consumed" so renders don't keep re-selecting. */
export function markDeepLinkResolved() {
    state.deepLinkResolved = true;
}

export function setLiveFilter(on) {
    state.liveFilter = !!on;
    PREFS.liveFilter.set(state.liveFilter);
    bus.emit('liveFilter:changed', state.liveFilter);
}

export function setSummary({ open, group, view }) {
    if (open  !== undefined) { state.summaryOpen  = open;  PREFS.summaryOpen.set(open); }
    if (group !== undefined) { state.summaryGroup = group; PREFS.summaryGroup.set(group); }
    if (view  !== undefined) { state.summaryView  = view;  PREFS.summaryView.set(view); }
    bus.emit('summary:changed', {
        open: state.summaryOpen, group: state.summaryGroup, view: state.summaryView,
    });
}

export function setEndpoint(endpoint, routePrefix) {
    state.endpoint    = endpoint;
    state.routePrefix = routePrefix;
}

// ── Sort helper (kept here so all writers share it) ────────────────────────
function sortEvents() {
    // The table will re-sort with its own comparator when a derived column
    // (e.g. context.userId) is selected — but the default chronological
    // order keeps the SSE-newest-first feel intact for table renders.
    state.events.sort((a, b) => (b.receivedAt || b.timestamp) - (a.receivedAt || a.timestamp));
}

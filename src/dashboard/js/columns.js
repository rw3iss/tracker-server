/**
 * columns.js — column registry + multi-select picker for the events table.
 *
 * The registry (`COLUMNS`) is the single source of truth for every field we
 * can show. Each entry declares:
 *   • `key`         internal id, used in localStorage + sort key
 *   • `label`       display label
 *   • `group`       section in the picker dropdown (Core / Error / Context / …)
 *   • `accessor`    (event) => raw value, for both rendering and client sort
 *   • `format`      optional renderer hint ('badge', 'relativeTime', 'datetime',
 *                   'truncate', 'mono', 'mono-truncate')
 *   • `sortBy`      if set, send this key to the server's sortBy param —
 *                   otherwise the table falls back to a client-side comparator.
 *   • `default`     true if the column is shown out-of-the-box.
 *   • `defaultWidth` initial column width in px. The user can resize from
 *                   here via the right-edge drag handle; resized values are
 *                   persisted in `PREFS.columnWidths` and override.
 *   • `flex`        true → column should claim leftover horizontal space
 *                   when the table has room (e.g. message body).
 *
 * Adding a new column = add one entry here. The picker, the table renderer,
 * the sort logic, the resize handles, and the drag-reorder handlers all
 * derive from this list — no place else to update.
 */

import { state, setVisibleColumns, PREFS } from './state.js';

export const COLUMNS = [
    // Core (table essentials).
    //
    // Width policy: the table is `width: 100%; table-layout: fixed`, so
    // when the colgroup widths sum to less than the viewport the browser
    // scales each column up proportionally to its declared width. Set
    // the fixed-purpose columns (Time / Type / App / Status) to compact
    // values close to their content size, then give Message and Payload
    // matching large widths so they each get ~50% of the remaining
    // space — that's how the screenshot layout is reproduced without
    // explicit flex math.
    { key: 'time',      label: 'Time',     group: 'Core', accessor: e => e.receivedAt || e.timestamp, sortBy: 'receivedAt', format: 'relativeTime', default: true,  defaultWidth: 90 },
    { key: 'type',      label: 'Type',     group: 'Core', accessor: e => e.type,                       sortBy: 'type',      format: 'badge',         default: true,  defaultWidth: 90 },
    { key: 'appId',     label: 'App',      group: 'Core', accessor: e => e.appId,                      sortBy: 'appId',                              default: true,  defaultWidth: 160 },
    { key: 'message',   label: 'Message',  group: 'Core', accessor: e => e.message,                    sortBy: 'message',   format: 'truncate',     default: true,  defaultWidth: 600, flex: true },
    { key: 'payload',   label: 'Payload',  group: 'Core', accessor: e => e.payload ? JSON.stringify(e.payload) : '',                                format: 'truncate',     default: true,  defaultWidth: 600, flex: true },
    { key: 'status',    label: 'Status',   group: 'Core', accessor: e => e.status,                     sortBy: 'status',                             default: true,  defaultWidth: 100 },

    // Identifiers
    { key: 'category',  label: 'Category', group: 'Identifiers', accessor: e => e.category,            sortBy: 'category',                                  defaultWidth: 140 },
    { key: 'id',        label: 'ID',       group: 'Identifiers', accessor: e => e.id,                  sortBy: 'id',         format: 'mono-truncate',       defaultWidth: 140 },
    { key: 'tags',      label: 'Tags',     group: 'Identifiers', accessor: e => (e.tags ?? []).join(', '),                                                  defaultWidth: 160 },
    { key: 'count',     label: 'Count',    group: 'Identifiers', accessor: e => e.count ?? 1,                                                                defaultWidth: 70 },

    // Time
    { key: 'timestamp', label: 'Captured', group: 'Time', accessor: e => e.timestamp,  sortBy: 'timestamp',  format: 'datetime', defaultWidth: 170 },
    { key: 'receivedAt',label: 'Received', group: 'Time', accessor: e => e.receivedAt, sortBy: 'receivedAt', format: 'datetime', defaultWidth: 170 },

    // Error
    { key: 'error.name',    label: 'Error name',    group: 'Error', accessor: e => e.error?.name,                                       defaultWidth: 160 },
    { key: 'error.message', label: 'Error message', group: 'Error', accessor: e => e.error?.message, format: 'truncate',                defaultWidth: 360 },

    // Context (dot keys → JSONB columns server-side; client-side sort only)
    { key: 'context.userId',      label: 'User',       group: 'Context', accessor: e => e.context?.userId,      format: 'mono-truncate', defaultWidth: 140 },
    { key: 'context.sessionId',   label: 'Session',    group: 'Context', accessor: e => e.context?.sessionId,   format: 'mono-truncate', defaultWidth: 140 },
    { key: 'context.environment', label: 'Env',        group: 'Context', accessor: e => e.context?.environment,                          defaultWidth: 110 },
    { key: 'context.appVersion',  label: 'Version',    group: 'Context', accessor: e => e.context?.appVersion,                           defaultWidth: 100 },
    { key: 'context.url',         label: 'URL',        group: 'Context', accessor: e => e.context?.url,         format: 'truncate',      defaultWidth: 320 },
    { key: 'context.path',        label: 'Path',       group: 'Context', accessor: e => e.context?.path,                                 defaultWidth: 200 },
    { key: 'context.referrer',    label: 'Referrer',   group: 'Context', accessor: e => e.context?.referrer,    format: 'truncate',      defaultWidth: 280 },
    { key: 'context.userAgent',   label: 'User-Agent', group: 'Context', accessor: e => e.context?.userAgent,   format: 'truncate',      defaultWidth: 320 },
    { key: 'context.language',    label: 'Lang',       group: 'Context', accessor: e => e.context?.language,                             defaultWidth: 80 },
    { key: 'context.timezone',    label: 'TZ',         group: 'Context', accessor: e => e.context?.timezone,                             defaultWidth: 130 },
    { key: 'context.connection',  label: 'Net',        group: 'Context', accessor: e => e.context?.connection,                           defaultWidth: 80 },
    { key: 'context.viewport',    label: 'Viewport',   group: 'Context', accessor: e => e.context?.viewport ? `${e.context.viewport.width}×${e.context.viewport.height}` : '', defaultWidth: 110 },
    { key: 'context.screen',      label: 'Screen',     group: 'Context', accessor: e => e.context?.screen   ? `${e.context.screen.width}×${e.context.screen.height}`     : '', defaultWidth: 110 },
];

const DEFAULT_KEYS = COLUMNS.filter(c => c.default).map(c => c.key);

const MIN_WIDTH = 60;
const MAX_WIDTH = 1200;

/** Resolve the current width for a column (persisted, else defaultWidth). */
export function getColumnWidth(key) {
    const widths = PREFS.columnWidths.get();
    const persisted = widths?.[key];
    if (typeof persisted === 'number' && persisted >= MIN_WIDTH) return persisted;
    return findColumn(key)?.defaultWidth ?? 140;
}

/** Persist the width for a single column. Clamped to [MIN, MAX]. */
export function setColumnWidth(key, px) {
    const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(px)));
    PREFS.columnWidths.update(w => ({ ...w, [key]: clamped }));
    return clamped;
}

/** Reset every column width back to its registry default. */
export function resetColumnWidths() {
    PREFS.columnWidths.set({});
}

/** Resolve the active column keys, falling back to defaults when unset. */
export function getVisibleKeys() {
    const stored = state.visibleColumns;
    if (Array.isArray(stored) && stored.length) return stored;
    return DEFAULT_KEYS;
}

/** Resolve column definitions in the order the user picked them. */
export function getVisibleColumns() {
    const keys = getVisibleKeys();
    const byKey = new Map(COLUMNS.map(c => [c.key, c]));
    return keys.map(k => byKey.get(k)).filter(Boolean);
}

/** Lookup a single column by its key. */
export function findColumn(key) {
    return COLUMNS.find(c => c.key === key) || null;
}

/** Mount the column picker dropdown. Closes on outside click. */
export function mountColumnPicker() {
    const btn   = document.getElementById('btn-cols-toggle');
    const panel = document.getElementById('cols-panel');
    if (!btn || !panel) return;

    render(panel);

    btn.addEventListener('click', e => {
        e.stopPropagation();
        panel.hidden = !panel.hidden;
    });
    document.addEventListener('click', e => {
        if (!panel.contains(e.target) && e.target !== btn) panel.hidden = true;
    });
}

function render(panel) {
    const visible = new Set(getVisibleKeys());
    const grouped = groupBy(COLUMNS, c => c.group);

    panel.innerHTML = `<div class="tk-cols"></div>`;
    const grid = panel.querySelector('.tk-cols');

    for (const [group, cols] of grouped) {
        const head = document.createElement('div');
        head.className = 'tk-cols__group';
        head.textContent = group;
        grid.appendChild(head);

        for (const col of cols) {
            const id = `col-${col.key.replace(/\W/g, '_')}`;
            const lbl = document.createElement('label');
            lbl.className = 'tk-cols__item';
            lbl.htmlFor   = id;
            lbl.innerHTML = `
                <input type="checkbox" id="${id}" data-key="${col.key}" ${visible.has(col.key) ? 'checked' : ''} />
                <span>${col.label}</span>`;
            grid.appendChild(lbl);
        }
    }

    const actions = document.createElement('div');
    actions.className = 'tk-cols__actions';
    actions.innerHTML = `
        <button class="tk-btn tk-btn--ghost" data-action="defaults">Reset</button>
        <button class="tk-btn tk-btn--ghost" data-action="all">All</button>
        <button class="tk-btn tk-btn--ghost" data-action="none">None</button>`;
    panel.appendChild(actions);

    panel.addEventListener('change', e => {
        if (!(e.target instanceof HTMLInputElement)) return;
        const key = e.target.dataset.key;
        if (!key) return;
        const next = new Set(getVisibleKeys());
        if (e.target.checked) next.add(key); else next.delete(key);
        // Preserve user-defined order: keep the existing keys in order, then
        // append any newly-added ones at the end.
        const existing = getVisibleKeys().filter(k => next.has(k));
        const added    = [...next].filter(k => !existing.includes(k));
        setVisibleColumns([...existing, ...added]);
    });

    actions.addEventListener('click', e => {
        const action = e.target.closest('button')?.dataset.action;
        if (!action) return;
        if (action === 'defaults') setVisibleColumns(DEFAULT_KEYS.slice());
        if (action === 'all')      setVisibleColumns(COLUMNS.map(c => c.key));
        if (action === 'none')     setVisibleColumns([]);
        // Re-render checkboxes to reflect the change.
        render(panel);
    });
}

function groupBy(items, fn) {
    const m = new Map();
    for (const it of items) {
        const k = fn(it);
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(it);
    }
    return m;
}

/**
 * table.js — renders the events <thead>/<tbody> from the column registry,
 * handles sort clicks, lets the user resize and reorder columns, and
 * emits row selection back to the rest of the app.
 *
 * Sort behaviour:
 *   • If the active column has `sortBy` set, sorting is delegated to the
 *     server (next reconnect uses the new sort key).
 *   • Otherwise we fall back to a client-side comparator. This keeps
 *     `context.userId`, `tags`, `payload`, etc. usable for sort even though
 *     the backend doesn't know how to sort by them.
 *
 * Truncation behaviour:
 *   • Columns are sized from a per-column persisted width (or the column
 *     entry's `defaultWidth`).
 *   • The table itself uses `table-layout: fixed`, so each cell's
 *     overflow:hidden + text-overflow:ellipsis decide what fits at the
 *     current width. No JS substring chopping.
 *


 * Per-column UI state lives in PREFS.columnWidths and PREFS.visibleColumns
 * (registered in state.js), so resize/reorder/show-hide all survive a reload.
 *
 * Scroll behaviour:
 *   • Events are sorted newest-first; the table never auto-scrolls.
 *   • New events arrive at index 0, so a user parked at the top sees them
 *     instantly. A user who scrolled away to read older events stays put.
 */

import { state, bus, setSelected, setSort, setVisibleColumns } from './state.js';
import { getVisibleColumns, getVisibleKeys, findColumn, getColumnWidth, setColumnWidth } from './columns.js';
import { relativeTime, formatDateTime, escapeHtml, comparator } from './utils.js';

const els = {
    headerRow: null,
    colgroup:  null,
    tbody:     null,
    emptyMsg:  null,
    statTotal: null,
    statErr:   null,
    statWarn:  null,
};

let onSortDelegated = () => {};

/**
 * Mount the table.
 * @param {(sortKey: string) => void} onServerSortChange
 *   Called when the user clicks a column whose `sortBy` is set — main.js
 *   reconnects in response so the new ordering is applied at the source.
 */
export function mountTable(onServerSortChange) {
    els.headerRow = document.getElementById('header-row');
    els.tbody     = document.getElementById('event-tbody');
    els.emptyMsg  = document.getElementById('empty-msg');
    els.statTotal = document.getElementById('stat-total');
    els.statErr   = document.getElementById('stat-errors');
    els.statWarn  = document.getElementById('stat-warnings');

    // Inject a <colgroup> so column widths are applied symmetrically to
    // both the header cells and the body cells. Cleaner than per-cell
    // width inline styles, and a single source of truth per render.
    ensureColgroup();

    onSortDelegated = onServerSortChange;

    els.tbody.addEventListener('click', handleRowClick);

    bus.on('events:changed',   render);
    bus.on('columns:changed',  render);
    // Re-render on sort changes too. For server-sorted columns the
    // reconnect path triggers events:changed once the new fetch lands,
    // but client-sorted columns (no `sortBy` on the registry entry)
    // never reconnect — so the table needs to listen for the sort
    // change itself, otherwise clicking those headers updated state
    // but left the rendered rows in their old order.
    bus.on('sort:changed',     render);
    bus.on('selection:changed', updateSelectionHighlight);

    render();

    // Refresh relative-time cells without a full re-render.
    setInterval(refreshRelativeTimes, 10_000);
}

// ── Render ────────────────────────────────────────────────────────────────
/**
 * Re-render the table. Never auto-scrolls — events are sorted newest-first
 * so new arrivals appear at the top of their own accord. The user's scroll
 * position inside the table-wrap is preserved across renders, so if they're
 * at the top they keep seeing new events; if they've scrolled down to read
 * older events, they stay where they are.
 */
function render() {
    const cols = getVisibleColumns();
    const data = sortForView(state.events, cols);

    renderColgroup(cols);
    renderHeader(cols);
    renderBody(cols, data);
    renderStats(state.events);
    els.emptyMsg.hidden = state.events.length > 0;
}

function ensureColgroup() {
    const table = els.headerRow.closest('table');
    let cg = table.querySelector('colgroup');
    if (!cg) {
        cg = document.createElement('colgroup');
        table.insertBefore(cg, table.firstChild);
    }
    els.colgroup = cg;
}

function renderColgroup(cols) {
    els.colgroup.innerHTML = '';
    for (const col of cols) {
        const c = document.createElement('col');
        c.style.width = getColumnWidth(col.key) + 'px';
        c.dataset.key = col.key;
        els.colgroup.appendChild(c);
    }
}

function renderHeader(cols) {
    els.headerRow.innerHTML = '';
    for (const col of cols) {
        const th = document.createElement('th');
        th.className   = 'sortable';
        th.dataset.col = col.key;
        th.draggable   = true;
        const arrow = state.sortBy === effectiveSortKey(col)
            ? `<span class="sort-arrow active">${state.sortDir === 'asc' ? '▲' : '▼'}</span>`
            : `<span class="sort-arrow">▲</span>`;
        th.innerHTML = `<span class="tk-th-label">${escapeHtml(col.label)}</span> ${arrow}`;

        // Resize handle. Owns its own mousedown so the parent <th>'s
        // native drag and click events never see the resize gesture.
        const grip = document.createElement('span');
        grip.className = 'tk-th-resize';
        grip.addEventListener('mousedown', e => beginResize(e, col.key, th));
        th.appendChild(grip);

        // Click-to-sort needs custom detection because the <th> is
        // `draggable="true"` for column reorder. The browser's HTML5
        // drag-and-drop fires `dragstart` after only a few px of cursor
        // movement and suppresses the subsequent `click` — so a click
        // with the slightest jitter silently drops the sort. Instead,
        // we track mousedown position and the dragstart flag set in
        // wireDragReorder; on mouseup, if neither the cursor moved
        // > 4 px nor a real drag occurred, treat it as a click → sort.
        let downX = 0, downY = 0;
        const dragState = { dragged: false };
        th.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            if (e.target.closest('.tk-th-resize')) return;
            downX = e.clientX;
            downY = e.clientY;
            dragState.dragged = false;
        });
        th.addEventListener('mouseup', e => {
            if (e.button !== 0) return;
            if (e.target.closest('.tk-th-resize')) return;
            if (dragState.dragged) return;
            const dx = Math.abs(e.clientX - downX);
            const dy = Math.abs(e.clientY - downY);
            if (dx > 4 || dy > 4) return;
            handleHeaderSort(col);
        });

        wireDragReorder(th, col.key, dragState);
        els.headerRow.appendChild(th);
    }
}

function renderBody(cols, data) {
    const frag = document.createDocumentFragment();
    for (const ev of data) {
        const tr = document.createElement('tr');
        tr.dataset.id = ev.id;
        if (state.selectedId === ev.id) tr.classList.add('selected');

        for (const col of cols) {
            const td = document.createElement('td');
            const html = renderCell(col, ev);
            td.innerHTML = html;
            // Title attribute gives the user the full value on hover when
            // the cell ellipsises. Skip for cells that already render
            // their own structured markup (e.g. badges).
            const raw = col.accessor(ev);
            if (raw != null && raw !== '' && col.format !== 'badge') {
                td.title = String(raw);
            }
            tr.appendChild(td);
        }
        frag.appendChild(tr);
    }
    els.tbody.innerHTML = '';
    els.tbody.appendChild(frag);
}

function renderCell(col, ev) {
    const value = col.accessor(ev);
    if (value == null || value === '') return '<span class="text-dim">—</span>';
    switch (col.format) {
        case 'badge':
            return `<span class="tk-badge tk-badge--${escapeHtml(value)}">${escapeHtml(value)}</span>`;
        case 'relativeTime':
            return `<span class="text-dim">${escapeHtml(relativeTime(value))}</span>`;
        case 'datetime':
            return `<span class="text-dim text-mono">${escapeHtml(formatDateTime(value))}</span>`;
        case 'mono-truncate':
        case 'mono':
            return `<span class="text-mono">${escapeHtml(String(value))}</span>`;
        case 'truncate':
        default:
            // The cell itself ellipsises via CSS — render the full string
            // and let the column width decide what shows.
            return escapeHtml(String(value));
    }
}

function renderStats(events) {
    els.statTotal.textContent = events.length;
    els.statErr.textContent   = events.filter(e => e.type === 'error').length;
    els.statWarn.textContent  = events.filter(e => e.type === 'warning').length;
}

// ── Sort ──────────────────────────────────────────────────────────────────

/** Returns the actual key state.sortBy will hold when sorting by this col. */
function effectiveSortKey(col) {
    return col.sortBy ?? `client:${col.key}`;
}

function sortForView(events, cols) {
    const isClient = state.sortBy.startsWith('client:');
    if (!isClient) return events; // server-sorted; trust the order we received

    const colKey = state.sortBy.slice('client:'.length);
    const col    = findColumn(colKey);
    if (!col) return events;
    return [...events].sort(comparator(col.accessor, state.sortDir));
}

function handleHeaderSort(col) {
    const key = effectiveSortKey(col);
    const dir = (state.sortBy === key && state.sortDir === 'desc') ? 'asc' : 'desc';
    setSort(key, dir);
    if (col.sortBy) onSortDelegated(col.sortBy);
}

// ── Resize ────────────────────────────────────────────────────────────────
/**
 * Drag-to-resize for a column. The grip is rendered at the right edge of
 * each header cell, so a grip on column N resizes column N (its right
 * border == the visual left border of column N+1).
 *
 * Two subtleties this handler gets right where naive implementations
 * break:
 *
 *   1. The parent <th> is `draggable="true"` for column-reorder. Without
 *      intervention the browser races the native HTML5 drag-and-drop
 *      against our resize gesture: as soon as the cursor moves a few px
 *      the <th> fires `dragstart`, the column visually jumps to follow
 *      the drag image, then snaps back when the drag ends. We suppress
 *      that by toggling `th.draggable = false` for the duration of the
 *      resize and restoring it on mouseup.
 *
 *   2. Resizing the dragged column N also adjusts column N+1 by the
 *      inverse delta. Total table width stays constant, the rest of the
 *      layout doesn't shift, and the cursor visually tracks the border
 *      between N and N+1 throughout the gesture — exactly what a user
 *      who clicked "the left edge of column N+1" expects. When N is the
 *      last visible column there's no neighbor to compensate against,
 *      so we fall back to the simple grow/shrink behavior.
 */
function beginResize(e, key, th) {
    e.preventDefault();
    e.stopPropagation();

    // ── Suppress the column-reorder drag for the duration of the resize.
    // `draggable=false` is read by the browser on every drag attempt,
    // not just on attach, so flipping it here is enough.
    th.draggable = false;

    // ── Identify the right neighbor (the column we'll compensate against).
    const cols       = getVisibleColumns();
    const idx        = cols.findIndex(c => c.key === key);
    const neighbor   = idx >= 0 && idx < cols.length - 1 ? cols[idx + 1] : null;

    const startX     = e.clientX;
    const startW     = getColumnWidth(key);
    const startWNext = neighbor ? getColumnWidth(neighbor.key) : 0;

    // Logical-vs-displayed pixel scale.
    //
    // The table is `width: 100%; table-layout: fixed` and our colgroup
    // entries carry "logical" pixel widths. When the colgroup widths
    // sum to less than the table's actual rendered width, the browser
    // scales each column UP proportionally so they fill the table —
    // sometimes 1.5×, 2×, more. Without compensation, every screen
    // pixel of cursor travel applied 1× to the logical width but
    // produced N× of visible movement, making the resize feel
    // overshooting (the user reported "moves about twice as far").
    //
    // We capture the ratio (displayed / logical) at gesture start and
    // divide every cursor-delta by it before applying. With the
    // neighbor-compensation rule keeping the colgroup sum constant,
    // the ratio doesn't drift mid-gesture, so caching once is fine.
    const startWDisplayed = th.offsetWidth;
    const scale           = startWDisplayed / Math.max(startW, 1);

    const grip = e.currentTarget;
    grip.classList.add('is-active');
    document.body.style.cursor = 'col-resize';

    const updateWidth = (k, px) => {
        const applied = setColumnWidth(k, px);
        const col = els.colgroup?.querySelector(`col[data-key="${cssEscape(k)}"]`);
        if (col) col.style.width = applied + 'px';
        return applied;
    };

    const onMove = ev => {
        // Convert screen-pixel cursor travel into the same units the
        // colgroup widths use. With scale=1 (no upscaling) this is a
        // no-op; with scale=2 it halves the delta so the column edge
        // tracks the cursor visibly.
        const delta = (ev.clientX - startX) / scale;

        if (!neighbor) {
            // Last column: no compensation possible — just resize self.
            updateWidth(key, startW + delta);
            return;
        }

        // Clamp delta so neither side crosses the min-width floor.
        // setColumnWidth already enforces the floor, but doing it here
        // keeps the cursor-to-border tracking honest (the border won't
        // continue to follow the cursor past the point where it can
        // actually move).
        const minWidth   = 60;     // matches MIN_WIDTH in columns.js
        const maxIncrease =  startWNext - minWidth;   // how far we can grow self before neighbor hits min
        const maxDecrease =  startW     - minWidth;   // how far we can shrink self before self hits min
        const clamped     = Math.max(-maxDecrease, Math.min(maxIncrease, delta));

        updateWidth(key,          startW     + clamped);
        updateWidth(neighbor.key, startWNext - clamped);
    };

    const onUp = () => {
        grip.classList.remove('is-active');
        document.body.style.cursor = '';
        th.draggable = true;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}

// ── Drag-to-reorder ───────────────────────────────────────────────────────
function wireDragReorder(th, key, dragState) {
    th.addEventListener('dragstart', e => {
        e.dataTransfer?.setData('text/x-tk-col', key);
        e.dataTransfer.effectAllowed = 'move';
        th.classList.add('is-dragging');
        // Tell the click-detection code that this was a real drag,
        // so the upcoming mouseup doesn't fire a sort.
        if (dragState) dragState.dragged = true;
    });
    th.addEventListener('dragend', () => {
        th.classList.remove('is-dragging');
        // Belt-and-braces: remove any lingering drop highlight.
        els.headerRow.querySelectorAll('.is-drop-target').forEach(el => el.classList.remove('is-drop-target'));
    });
    th.addEventListener('dragenter', e => {
        if (!e.dataTransfer?.types.includes('text/x-tk-col')) return;
        e.preventDefault();
        th.classList.add('is-drop-target');
    });
    th.addEventListener('dragover', e => {
        if (!e.dataTransfer?.types.includes('text/x-tk-col')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    });
    th.addEventListener('dragleave', () => {
        th.classList.remove('is-drop-target');
    });
    th.addEventListener('drop', e => {
        e.preventDefault();
        th.classList.remove('is-drop-target');
        const src = e.dataTransfer?.getData('text/x-tk-col');
        const dst = key;
        if (!src || src === dst) return;
        reorder(src, dst);
    });
}

function reorder(src, dst) {
    const keys = getVisibleKeys().slice();
    const from = keys.indexOf(src);
    const to   = keys.indexOf(dst);
    if (from < 0 || to < 0) return;
    keys.splice(from, 1);
    keys.splice(to,   0, src);
    setVisibleColumns(keys);
}

// ── Selection ─────────────────────────────────────────────────────────────
function handleRowClick(e) {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    setSelected(tr.dataset.id);
}

function updateSelectionHighlight(id) {
    els.tbody.querySelectorAll('tr').forEach(r => {
        r.classList.toggle('selected', r.dataset.id === id);
    });
}

// ── Time refresh ──────────────────────────────────────────────────────────
function refreshRelativeTimes() {
    const cols = getVisibleColumns();
    const timeIdx = cols.findIndex(c => c.format === 'relativeTime');
    if (timeIdx < 0) return;
    els.tbody.querySelectorAll('tr').forEach(tr => {
        const ev = state.events.find(e => e.id === tr.dataset.id);
        const td = tr.children[timeIdx];
        if (ev && td) {
            td.innerHTML = `<span class="text-dim">${escapeHtml(relativeTime(cols[timeIdx].accessor(ev)))}</span>`;
        }
    });
}

// CSS.escape isn't always available in older runtimes; this is sufficient
// for our column keys (alphanum, dot, dash, colon).
function cssEscape(s) {
    return s.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
}

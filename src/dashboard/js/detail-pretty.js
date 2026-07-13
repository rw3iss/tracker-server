/**
 * detail-pretty.js — "Pretty mode" renderer for the event detail panel.
 *
 * Replaces the raw JSON dump with a labeled, columnar layout. Every
 * value is copyable. Property values that are themselves objects /
 * non-primitive arrays render as collapsible nested groups: clicking
 * the field's label folds the children. Each column header is also a
 * click target — collapsing the entire General / Payload / Error
 * section. The Payload column gains Expand all / Collapse all
 * shortcuts since it's the section most likely to host deep nesting.
 *
 * Composed from a tiny set of primitives so the layout stays
 * consistent regardless of which event shape lands in the panel:
 *
 *   el(tag, className, content)   build a DOM node in one line
 *   field(label, value)           label-above-value pair
 *   renderValue(v)                pick the right view per type
 *   copyButton(text)              clipboard icon button
 *   chevron()                     ▾ icon used by collapsibles
 *   column(title, fields, count, actions)
 *                                  one .tk-pretty__column section
 *                                  with a clickable header
 *
 * Render plan for an event:
 *
 *   ┌─ General ─────────┐ ┌─ Payload  [Expand][Collapse] ┐ ┌─ Error ─┐
 *   │ App / Type / …    │ │ orderId / amount / …          │ │ Name…   │
 *   └───────────────────┘ └───────────────────────────────┘ └─────────┘
 *
 * Object-valued fields render with a chevron next to the label and
 * collapse on click. Recursion goes through `field()` so nested
 * objects-of-objects are collapsible at every depth.
 */

import { makeCopyButton } from './clipboard.js';

// ── Tiny DOM builder helpers ──────────────────────────────────────────────

function el(tag, className, content) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (content == null) return n;
    if (Array.isArray(content)) for (const c of content) appendChildLike(n, c);
    else                        appendChildLike(n, content);
    return n;
}

function appendChildLike(parent, c) {
    if (c == null) return;
    if (typeof c === 'string' || typeof c === 'number') parent.appendChild(document.createTextNode(String(c)));
    else                                                 parent.appendChild(c);
}

// ── Iconography ───────────────────────────────────────────────────────────

/** Down-chevron — rotated -90deg by `.is-collapsed` rule. */
const CHEVRON_SVG = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="6 9 12 15 18 9"></polyline>
    </svg>`;

/** Returns an SVG chevron with the requested class applied directly
 *  to the <svg> element. (innerHTML on a wrapper span loses the
 *  className we want CSS to size — apply it post-parse.) */
function chevron(className) {
    const tmp = document.createElement('span');
    tmp.innerHTML = CHEVRON_SVG;
    const svg = tmp.firstElementChild;
    svg.classList.add(className);
    return svg;
}

// ── Copy button (delegated to shared clipboard helper) ────────────────────

/** Tiny adapter so the rest of this file can keep its existing
 *  `copyButton(text, 'label')` ergonomics while delegating the actual
 *  build + click + flash logic to `clipboard.makeCopyButton`. The
 *  visual UX (icon → checkmark → icon) lives in one place now. */
function copyButton(textOrFn, label = 'Copy') {
    return makeCopyButton(textOrFn, { label });
}

// ── Value renderer ────────────────────────────────────────────────────────

/**
 * Render a value into a `.tk-pretty__value` container.
 *
 * Decision table:
 *   null/undefined        → "—" placeholder, no copy button.
 *   multiline string      → <pre> with copy.
 *   primitive             → inline text + copy DIRECTLY after it.
 *   array of primitives   → CSV-like inline + copy.
 *   array of objects /
 *     plain object        → nested fields; the parent is rendered as a
 *                            collapsible field by the caller.
 *
 * Returns `{ valueEl, isObjectShaped }`. `isObjectShaped === true` tells
 * the caller to make the surrounding `.tk-pretty__field` collapsible
 * (only object/array-of-object values are foldable).
 */
function renderValue(value, opts = {}) {
    if (value == null || value === '') {
        return {
            valueEl: el('div', 'tk-pretty__value', el('span', 'tk-pretty__value-empty', '—')),
            isObjectShaped: false,
        };
    }

    // Multi-line string → block-display <pre>.
    if (typeof value === 'string' && value.includes('\n')) {
        const wrap = el('div', 'tk-pretty__value tk-pretty__value--block', [
            el('pre', 'tk-pretty__pre', value),
            // Copy sits below for block values, since the pre is full-width.
            copyButton(opts.copyValue ?? value),
        ]);
        return { valueEl: wrap, isObjectShaped: false };
    }

    // Plain primitive (string / number / boolean).
    if (typeof value !== 'object') {
        const text = String(value);
        const wrap = el('div', 'tk-pretty__value', [
            el('span', 'tk-pretty__value-text', text),
            copyButton(opts.copyValue ?? text),
        ]);
        return { valueEl: wrap, isObjectShaped: false };
    }

    // Array of primitives → inline CSV.
    if (Array.isArray(value) && value.every(v => v == null || typeof v !== 'object')) {
        const text = value.map(v => v == null ? 'null' : String(v)).join(', ');
        const wrap = el('div', 'tk-pretty__value', [
            el('span', 'tk-pretty__value-text', text),
            copyButton(opts.copyValue ?? text),
        ]);
        return { valueEl: wrap, isObjectShaped: false };
    }

    // Object or array-of-objects → nested children, copy as JSON.
    const nested = el('div', 'tk-pretty__nested');
    if (Array.isArray(value)) {
        value.forEach((item, i) => nested.appendChild(field(`[${i}]`, item)));
    } else {
        for (const [k, v] of Object.entries(value)) {
            nested.appendChild(field(humanLabel(k), v, { copyValue: stringify(v) }));
        }
    }
    const wrap = el('div', 'tk-pretty__value tk-pretty__value--block', [nested]);
    return { valueEl: wrap, isObjectShaped: true };
}

// ── Labeled field (label above value) ─────────────────────────────────────

/**
 * Build one `.tk-pretty__field`. When the value renders as a nested
 * group of children, the field becomes collapsible — clicking the
 * label folds the children. The whole-field copy (JSON) sits inline
 * with the label so users can grab the entire object as a string.
 */
function field(label, value, opts = {}) {
    const { valueEl, isObjectShaped } = renderValue(value, opts);

    const labelEl = el('div', 'tk-pretty__label');
    if (isObjectShaped) labelEl.appendChild(chevron('tk-pretty__label-chevron'));
    labelEl.appendChild(document.createTextNode(label));

    // For collapsible (object) fields, give the user a quick whole-
    // value JSON copy on the label row so they can grab the entire
    // sub-tree without expanding it first.
    if (isObjectShaped) {
        labelEl.appendChild(copyButton(() => stringify(value), 'Copy JSON'));
    }

    const fieldEl = el('div', 'tk-pretty__field', [labelEl, valueEl]);

    if (isObjectShaped) {
        fieldEl.classList.add('tk-pretty__field--collapsible');
        labelEl.addEventListener('click', (e) => {
            // Don't toggle when the click landed on the inline copy
            // button — that's its own affordance.
            if (e.target.closest('.tk-pretty__copy')) return;
            fieldEl.classList.toggle('is-collapsed');
        });
    }

    return fieldEl;
}

// ── Column section ────────────────────────────────────────────────────────

/**
 * Build a `.tk-pretty__column`. The whole title bar is clickable to
 * collapse / expand the column. `actions` is an optional array of
 * inline buttons rendered on the right side of the title (used by
 * Payload to host Expand all / Collapse all).
 */
function column(title, fields, countLabel, actions) {
    const titleText = el('span', 'tk-pretty__column-title-text', [
        document.createTextNode(title),
        countLabel ? el('span', 'tk-pretty__column-title-count', countLabel) : null,
    ]);

    const titleEl = el('div', 'tk-pretty__column-title', [
        chevron('tk-pretty__column-title-chevron'),
        titleText,
    ]);

    if (actions && actions.length > 0) {
        const actionsEl = el('div', 'tk-pretty__column-actions', actions);
        // Action clicks shouldn't toggle the column.
        actionsEl.addEventListener('click', (e) => e.stopPropagation());
        titleEl.appendChild(actionsEl);
    }

    const colEl = el('section', 'tk-pretty__column', [titleEl, ...fields]);
    titleEl.addEventListener('click', () => colEl.classList.toggle('is-collapsed'));
    return colEl;
}

/** Tiny inline button factory for the per-column actions row. */
function columnActionButton(text, onClick) {
    const b = el('button', 'tk-pretty__column-action', text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
}

// ── Specialised value renderers ───────────────────────────────────────────

function renderTags(tags) {
    const wrap = el('div', 'tk-pretty__value');
    const list = el('div', 'tk-pretty__tags',
        tags.map(t => el('span', 'tk-pretty__tag', String(t))));
    wrap.appendChild(list);
    wrap.appendChild(copyButton(tags.join(', ')));
    return wrap;
}

/** Build the previous-causes nested block for the Error column. */
function renderErrorPrevious(prev) {
    const nested = el('div', 'tk-pretty__nested');
    prev.forEach((p, i) => {
        nested.appendChild(el('div', 'tk-pretty__nested-title', `Cause #${i + 1}`));
        for (const f of buildErrorFields(p, /* skipStack */ true)) nested.appendChild(f);
    });
    const labelEl = el('div', 'tk-pretty__label', [
        chevron('tk-pretty__label-chevron'),
        document.createTextNode(`Previous (${prev.length})`),
    ]);
    const fieldEl = el('div', 'tk-pretty__field tk-pretty__field--collapsible', [
        labelEl,
        el('div', 'tk-pretty__value tk-pretty__value--block', nested),
    ]);
    labelEl.addEventListener('click', (e) => {
        if (e.target.closest('.tk-pretty__copy')) return;
        fieldEl.classList.toggle('is-collapsed');
    });
    return fieldEl;
}

function buildErrorFields(err, skipStack = false) {
    const out = [];
    if (err.name)         out.push(field('Name',    err.name));
    if (err.message)      out.push(field('Message', err.message));
    if (err.code != null) out.push(field('Code',    err.code));
    if (err.file) {
        const where = err.line != null ? `${err.file}:${err.line}` : err.file;
        out.push(field('Location', where, { copyValue: where }));
    }
    if (!skipStack && err.stack) {
        out.push(field('Stack', err.stack, { copyValue: err.stack }));
    }
    if (Array.isArray(err.previous) && err.previous.length > 0) {
        out.push(renderErrorPrevious(err.previous));
    }
    return out;
}

// ── Column builders ───────────────────────────────────────────────────────

function buildGeneralColumn(ev) {
    const fields = [
        field('App',     ev.appId),
        field('Type',    ev.type),
        field('Status',  ev.status ?? 'new'),
        field('Message', ev.message),
    ];
    if (ev.category) fields.push(field('Category', ev.category));

    if (ev.timestamp) {
        const iso = new Date(Number(ev.timestamp)).toISOString();
        fields.push(field('Timestamp', iso, { copyValue: String(ev.timestamp) }));
    }
    if (ev.receivedAt) {
        const iso = new Date(Number(ev.receivedAt)).toISOString();
        fields.push(field('Received At', iso, { copyValue: String(ev.receivedAt) }));
    }
    if (ev.id) fields.push(field('Event Id', ev.id));

    if (Array.isArray(ev.tags) && ev.tags.length > 0) {
        fields.push(el('div', 'tk-pretty__field', [
            el('div', 'tk-pretty__label', 'Tags'),
            renderTags(ev.tags),
        ]));
    }
    if (ev.context && Object.keys(ev.context).length > 0) {
        fields.push(field('Context', ev.context, { copyValue: stringify(ev.context) }));
    }
    return column('General', fields);
}

function buildPayloadColumn(ev) {
    const entries = Object.entries(ev.payload);
    const fields = entries.map(([k, v]) => field(humanLabel(k), v, { copyValue: stringify(v) }));

    // Whole-payload copy. Sits at the LEFT of the action group so it
    // reads as the section's own affordance, distinct from the
    // expand/collapse-all buttons (which manipulate the displayed view
    // rather than producing output). Same icon-button style as the
    // per-field copies and the title-adjacent whole-event copy.
    const copyAll = makeCopyButton(
        () => stringify(ev.payload),
        { label: 'Copy payload JSON' },
    );

    // Expand all / Collapse all walk every collapsible descendant of
    // this column. Cheap — one DOM query each, classList toggles.
    const colRef = { current: null };
    const expandAll = columnActionButton('Expand all', () => {
        colRef.current?.querySelectorAll('.tk-pretty__field--collapsible').forEach(f => f.classList.remove('is-collapsed'));
    });
    const collapseAll = columnActionButton('Collapse all', () => {
        colRef.current?.querySelectorAll('.tk-pretty__field--collapsible').forEach(f => f.classList.add('is-collapsed'));
    });

    const colEl = column(
        'Payload',
        fields,
        `${entries.length} ${entries.length === 1 ? 'field' : 'fields'}`,
        [copyAll, expandAll, collapseAll],
    );
    colRef.current = colEl;
    return colEl;
}

function buildErrorColumn(ev) {
    return column('Error', buildErrorFields(ev.error));
}

// ── Public entry point ────────────────────────────────────────────────────

export function renderPretty(host, ev) {
    host.innerHTML = '';
    const grid = el('div', 'tk-pretty');
    grid.appendChild(buildGeneralColumn(ev));
    if (hasPayload(ev)) grid.appendChild(buildPayloadColumn(ev));
    if (ev.error)       grid.appendChild(buildErrorColumn(ev));
    host.appendChild(grid);
}

// ── Small utilities ───────────────────────────────────────────────────────

function hasPayload(ev) {
    return ev.payload && typeof ev.payload === 'object' && Object.keys(ev.payload).length > 0;
}

function stringify(v) {
    if (v == null) return '';
    if (typeof v === 'object') {
        try { return JSON.stringify(v, null, 2); }
        catch { return String(v); }
    }
    return String(v);
}

function humanLabel(key) {
    if (!key) return '';
    const words = String(key)
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .map(w => w[0].toUpperCase() + w.slice(1));
    const joined = words.join(' ');
    return joined.length > 30 ? joined.slice(0, 29) + '…' : joined;
}

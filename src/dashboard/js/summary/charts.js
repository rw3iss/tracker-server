/**
 * summary/charts.js — Chart.js wrappers for the three view modes.
 *
 * Each builder takes a parent <div>, a data shape, and an `onSelect(outer,
 * inner)` callback that fires when the user clicks a chart element. Returns
 * a destructor so callers can clean up before re-rendering.
 *
 * Why a layer over Chart.js: keeps the calling code (summary/index.js)
 * focused on "render this dataset for this mode" — colours, labels,
 * tooltips, click → drill-down, layout tweaks all live here.
 *
 * Click-to-filter:
 *   • Pie  → click a slice → `onSelect(outer, slice.label)`.
 *                            outer = this pie's outer key (e.g. 'error');
 *                            slice = inner key (e.g. 'api-server').
 *   • Bar  → click a stack segment → `onSelect(label, datasetLabel)`.
 *                                    label = X-axis (outer);
 *                                    datasetLabel = stack (inner).
 *   • Line → click a point → `onSelect(label, datasetLabel)`. Same shape.
 *
 * The summary controller maps `(outer, inner)` to a `{ appId, type }`
 * pair based on the active group mode, so this file doesn't need to know
 * about app vs type semantics — it just reports what was clicked.
 */

import { colorFor } from '../utils.js';

/* eslint-disable no-undef */ // Chart is loaded from a <script> tag.

/** Read a CSS custom property from <html>. */
function cssVar(name, fallback = '') {
    if (typeof document === 'undefined') return fallback;
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
}

/**
 * Theme-aware Chart.js plugin defaults — read at chart-creation time so
 * a re-render after a `theme:changed` event picks up the new palette.
 * Returns the values flat so each builder can spread them into its
 * options.plugins.{legend,tooltip} block.
 */
function chartTextColors() {
    return {
        legend:   cssVar('--text-muted', '#6b7280'),
        tooltip:  cssVar('--text',       '#111827'),
        grid:     cssVar('--border',     '#e5e7eb'),
        chartBg:  cssVar('--bg-card',    '#ffffff'),
    };
}

/** Create the framing chart card with title + canvas. */
function makeCard(parent, title, total) {
    const card = document.createElement('div');
    card.className = 'tk-chart';
    card.innerHTML = `
        <div class="tk-chart__title">
            <span>${title}</span>
            <span class="tk-chart__total">${total}</span>
        </div>
        <div class="tk-chart__canvas"><canvas></canvas></div>`;
    parent.appendChild(card);
    return card.querySelector('canvas');
}

/** Cursor-changes-on-hover so users see chart elements are clickable. */
function hoverCursor(event, elements) {
    const native = event.native ?? event;
    const target = native?.target;
    if (target && 'style' in target) {
        target.style.cursor = elements.length ? 'pointer' : 'default';
    }
}

/**
 * Render N pie charts — one per outer key. Each pie's slices are the inner
 * keys (so in default 'group by type' mode you get a pie per event type
 * with one slice per app).
 */
export function renderPies(parent, { outerKeys, innerKeys, counts, totals }, onSelect = () => {}) {
    const charts = [];
    const t = chartTextColors();
    for (const outer of outerKeys) {
        const labels = innerKeys.filter(k => (counts[outer]?.[k] ?? 0) > 0);
        const data   = labels.map(k => counts[outer][k] ?? 0);
        const colors = labels.map(colorFor);
        const canvas = makeCard(parent, outer, totals[outer] ?? 0);
        const chart = new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: colors,
                    borderColor: t.chartBg,
                    borderWidth: 2,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                onHover: hoverCursor,
                onClick: (_event, elements) => {
                    if (!elements.length) return;
                    const inner = labels[elements[0].index];
                    if (inner != null) onSelect(outer, inner);
                },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { boxWidth: 10, font: { size: 11 }, color: t.legend },
                    },
                    tooltip: {
                        callbacks: {
                            label: ctx => {
                                const v = ctx.parsed;
                                const total = totals[outer] ?? 0;
                                const pct = total ? Math.round((v / total) * 100) : 0;
                                return `${ctx.label}: ${v} (${pct}%)`;
                            },
                        },
                    },
                },
                cutout: '55%',
            },
        });
        charts.push(chart);
    }
    return () => charts.forEach(c => c.destroy());
}

/**
 * Render a single stacked-bar chart. X axis = outer keys, each stack
 * segment = an inner key. Click a segment to drill into that combination.
 */
export function renderBar(parent, { outerKeys, innerKeys, counts }, onSelect = () => {}) {
    const canvas = makeCard(parent, 'Stacked breakdown', sumAll(counts));
    const t = chartTextColors();
    const datasets = innerKeys.map(inner => ({
        label: inner,
        data:  outerKeys.map(o => counts[o]?.[inner] ?? 0),
        backgroundColor: colorFor(inner),
        borderRadius: 2,
        borderSkipped: false,
    }));
    const chart = new Chart(canvas, {
        type: 'bar',
        data: { labels: outerKeys, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            onHover: hoverCursor,
            onClick: (_event, elements) => {
                if (!elements.length) return;
                const { datasetIndex, index } = elements[0];
                const outer = outerKeys[index];
                const inner = datasets[datasetIndex]?.label;
                if (outer != null && inner != null) onSelect(outer, inner);
            },
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 }, color: t.legend } },
                tooltip: { mode: 'index', intersect: false },
            },
            scales: {
                x: { stacked: true, grid: { display: false }, ticks: { color: t.legend } },
                y: { stacked: true, beginAtZero: true, ticks: { precision: 0, color: t.legend }, grid: { color: t.grid } },
            },
        },
    });
    return () => chart.destroy();
}

/**
 * Render a single line chart that mirrors the bar chart's grouping:
 * X axis = outer keys (event types or app ids depending on group mode),
 * one line per inner key, points = count of (outer, inner) pairs.
 *
 * Click a point to drill into that (outer, inner) combination.
 */
export function renderLine(parent, { outerKeys, innerKeys, counts }, onSelect = () => {}) {
    const canvas = makeCard(parent, 'Counts by group', sumAll(counts));
    const t = chartTextColors();
    const datasets = innerKeys.map(inner => ({
        label: inner,
        data: outerKeys.map(o => counts[o]?.[inner] ?? 0),
        borderColor: colorFor(inner),
        backgroundColor: colorFor(inner),
        tension: 0.25,
        pointRadius: 4,
        pointHoverRadius: 6,
        borderWidth: 2,
        fill: false,
    }));
    const chart = new Chart(canvas, {
        type: 'line',
        data: { labels: outerKeys, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            onHover: hoverCursor,
            onClick: (_event, elements) => {
                if (!elements.length) return;
                const { datasetIndex, index } = elements[0];
                const outer = outerKeys[index];
                const inner = datasets[datasetIndex]?.label;
                if (outer != null && inner != null) onSelect(outer, inner);
            },
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 }, color: t.legend } },
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: t.legend } },
                y: { beginAtZero: true, ticks: { precision: 0, color: t.legend }, grid: { color: t.grid } },
            },
        },
    });
    return () => chart.destroy();
}

// ── small helpers ─────────────────────────────────────────────────────────
function sumAll(counts) {
    let total = 0;
    for (const inner of Object.values(counts)) total += sumValues(inner);
    return total;
}
function sumValues(obj) {
    let total = 0;
    for (const v of Object.values(obj)) total += v;
    return total;
}

/**
 * value-picker.js — factory for the toolbar's multi-select dropdown
 * pickers (apps, categories, future ones).
 *
 * Every picker has the same shape:
 *   • Button label that summarises the current selection
 *     ("All apps" / "auction-api-dev" / "3 categories").
 *   • Popover with a typeahead, a checkbox list of distinct values
 *     pulled from `GET /api/events/distinct?field=…`, and select-all /
 *     deselect-all actions.
 *   • Persisted per-picker selection via the standard Pref utility.
 *   • Comma-separated wire format on the query string.
 *
 * One factory function, two thin caller-side wrappers in app-picker.js
 * + category-picker.js. Adding a third (status, environment, etc.) is
 * a five-line file.
 *
 * SOLID-ish: this module owns how a picker behaves, the wrappers
 * choose what it picks. No backend knowledge — the caller picks the
 * `field` to fetch from the distinct endpoint.
 */

import { Pref }          from './prefs.js';
import { state, bus }    from './state.js';
import { escapeHtml }    from './utils.js';

/**
 * Build a picker controller. Returns the public surface used by
 * `filters.js`: `mount`, `getSelected`, `serialize`, `clear`,
 * `setSelected`, `matches`.
 *
 * @param {object} cfg
 * @param {string} [cfg.field]                distinct-endpoint `field=` value.
 *                                            When set, the picker fetches
 *                                            available values + counts on open.
 * @param {ReadonlyArray<string>} [cfg.staticValues]
 *        A fixed enum to render — useful for fields backed by a closed
 *        set on the server (e.g. event type, status). When `field` is
 *        also set, the picker fetches counts but renders the union of
 *        `staticValues` so the picker shows every option even if none
 *        have been seen yet.
 * @param {string} cfg.prefKey                ls key for selection persistence
 * @param {string} cfg.buttonId               id of the toolbar button
 * @param {string} cfg.panelId                id of the popover panel
 * @param {(event: any) => string} [cfg.eventAccessor]
 *        Reads the picker's field off an event. Defaults to `e[field]`
 *        (works for top-level event fields like `appId`, `category`).
 * @param {object} cfg.labels
 * @param {string} cfg.labels.all              "All apps" / "All categories"
 * @param {string} cfg.labels.singular         "app" / "category"
 * @param {string} cfg.labels.plural           "apps" / "categories"
 * @param {string} cfg.labels.searchPlaceholder optional — defaults to "Search…"
 */
export function createValuePicker(cfg) {
    const PREF = new Pref(cfg.prefKey, [], { validate: Array.isArray });
    const accessor = cfg.eventAccessor ?? ((event) => event?.[cfg.field]);

    /**
     * Last seen [{ value, count }]. Sources, in priority order:
     *   • `cfg.staticValues` is the canonical render set when present
     *     (counts merged from any successful distinct fetch).
     *   • `cfg.field` provides values + counts via the distinct endpoint.
     */
    let knownValues = (cfg.staticValues ?? []).map(v => ({ value: v, count: 0 }));
    /** In-popover typeahead value. */
    let search = '';

    const els = { btn: null, panel: null };

    function mount() {
        els.btn   = document.getElementById(cfg.buttonId);
        els.panel = document.getElementById(cfg.panelId);
        if (!els.btn || !els.panel) {
            return { getSelected, serialize, clear, setSelected, matches };
        }

        syncButtonLabel();

        els.btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (els.panel.hidden) openPanel();
            else                  els.panel.hidden = true;
        });

        document.addEventListener('click', (e) => {
            if (!els.panel.contains(e.target) && e.target !== els.btn) {
                els.panel.hidden = true;
            }
        });

        // Re-fetch the count column when events shift, so the dropdown
        // doesn't go stale while it's open.
        bus.on('events:changed', () => {
            if (!els.panel.hidden) refreshList();
        });

        return { getSelected, serialize, clear, setSelected, matches };
    }

    // ── Public API ────────────────────────────────────────────────────────
    function getSelected() {
        return PREF.get();
    }

    /** Comma-list for the URL query string. Empty when nothing selected. */
    function serialize() {
        const list = getSelected();
        return list.length ? list.join(',') : '';
    }

    function setSelected(list) {
        PREF.set(Array.isArray(list) ? list : []);
        syncButtonLabel();
        // Live-filter consumers — main.js subscribes and re-runs the
        // query (debounced) when state.liveFilter is on.
        bus.emit('filters:changed', { source: cfg.field });
    }

    function clear() {
        setSelected([]);
    }

    /**
     * SSE-side filter — does this event match the picker's selection?
     * `true` when nothing's selected (= no filter).
     */
    function matches(event) {
        const selected = getSelected();
        if (selected.length === 0) return true;
        const value = accessor(event);
        return value != null && selected.includes(value);
    }

    // ── Panel lifecycle ───────────────────────────────────────────────────
    async function openPanel() {
        els.panel.hidden = false;
        // Render synchronously off whatever we have — `staticValues` if
        // configured, otherwise the last fetch result, otherwise loading.
        if (knownValues.length) renderList();
        else                    renderLoading();
        if (cfg.field) await refreshList();
    }

    async function refreshList() {
        if (!cfg.field) return;
        try {
            const url = `${state.endpoint}${state.routePrefix}/events/distinct?field=${encodeURIComponent(cfg.field)}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const fetched = await res.json();
            knownValues = mergeValues(cfg.staticValues, fetched);
            renderList();
        } catch (err) {
            // Keep static values visible on fetch error; only show the
            // error state when there's nothing else to show.
            if (knownValues.length) return;
            renderError(err.message ?? String(err));
        }
    }

    /**
     * Merge a fixed enum with fetched [{ value, count }]. The enum
     * order is preserved (so types render error → warning → info →
     * debug → event); any fetched-but-unknown values get appended after.
     */
    function mergeValues(staticValues, fetched) {
        if (!staticValues || !staticValues.length) return fetched;
        const fetchedMap = new Map(fetched.map(({ value, count }) => [value, count]));
        const merged = staticValues.map(v => ({ value: v, count: fetchedMap.get(v) ?? 0 }));
        for (const { value, count } of fetched) {
            if (!staticValues.includes(value)) merged.push({ value, count });
        }
        return merged;
    }

    // ── Render ────────────────────────────────────────────────────────────
    function renderLoading() {
        els.panel.innerHTML = `<div class="tk-cols__group">Loading ${escapeHtml(cfg.labels.plural)}…</div>`;
    }

    function renderError(message) {
        els.panel.innerHTML = `
            <div class="tk-cols__group">${escapeHtml(cfg.labels.singular)} list unavailable</div>
            <div class="tk-popover__hint">${escapeHtml(message)}</div>`;
    }

    function renderList() {
        const selected = new Set(getSelected());
        const filter   = search.trim().toLowerCase();
        const visible  = filter
            ? knownValues.filter(v => v.value.toLowerCase().includes(filter))
            : knownValues;

        els.panel.innerHTML = [
            renderSearchInput(),
            renderItemList(visible, selected),
            renderActionsBar(),
        ].join('');

        wireSearch();
        wireCheckboxes();
        wireActions(visible);
    }

    /** Typeahead at the top of the popover. */
    function renderSearchInput() {
        const placeholder = cfg.labels.searchPlaceholder ?? 'Search…';
        return `
            <input type="text"
                   class="tk-popover__search"
                   placeholder="${escapeHtml(placeholder)}"
                   value="${escapeHtml(search)}"
                   autofocus />`;
    }

    /** Checkbox list with empty-state fallback. */
    function renderItemList(visible, selected) {
        if (visible.length === 0) {
            return `
                <div class="tk-cols tk-cols--single">
                    <div class="tk-popover__hint">No matching ${escapeHtml(cfg.labels.plural)}</div>
                </div>`;
        }
        return `
            <div class="tk-cols tk-cols--single">
                ${visible.map(({ value, count }) => renderItem(value, count, selected.has(value))).join('')}
            </div>`;
    }

    /** One row in the value list. */
    function renderItem(value, count, isSelected) {
        return `
            <label class="tk-cols__item">
                <input type="checkbox" data-value="${escapeHtml(value)}" ${isSelected ? 'checked' : ''} />
                <span class="tk-cols__item-label">${escapeHtml(value)}</span>
                <span class="tk-cols__item-count">${count}</span>
            </label>`;
    }

    /** "Select all" / "Deselect all" footer. */
    function renderActionsBar() {
        return `
            <div class="tk-cols__actions">
                <button class="tk-btn tk-btn--ghost" data-action="all">Select all</button>
                <button class="tk-btn tk-btn--ghost" data-action="none">Deselect all</button>
            </div>`;
    }

    function wireSearch() {
        const input = els.panel.querySelector('input[type="text"]');
        input.addEventListener('input', (e) => {
            search = e.target.value;
            renderList();
            // Restore caret + focus after re-render.
            const next = els.panel.querySelector('input[type="text"]');
            if (next) {
                next.focus();
                next.setSelectionRange(next.value.length, next.value.length);
            }
        });
    }

    function wireCheckboxes() {
        els.panel.addEventListener('change', (e) => {
            if (!(e.target instanceof HTMLInputElement) || !e.target.dataset.value) return;
            const next = new Set(getSelected());
            if (e.target.checked) next.add(e.target.dataset.value);
            else                  next.delete(e.target.dataset.value);
            setSelected([...next]);
        });
    }

    function wireActions(visible) {
        els.panel.querySelectorAll('[data-action]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                if (action === 'all')  setSelected(visible.map(v => v.value));
                if (action === 'none') setSelected([]);
                renderList();
            });
        });
    }

    // ── Helpers ───────────────────────────────────────────────────────────
    function syncButtonLabel() {
        if (!els.btn) return;
        const list = getSelected();
        if (list.length === 0) {
            els.btn.textContent = cfg.labels.all;
            els.btn.setAttribute('aria-pressed', 'false');
        } else if (list.length === 1) {
            els.btn.textContent = list[0];
            els.btn.setAttribute('aria-pressed', 'true');
        } else {
            els.btn.textContent = `${list.length} ${cfg.labels.plural}`;
            els.btn.setAttribute('aria-pressed', 'true');
        }
    }

    // The mount function is what `filters.js` calls — it returns the
    // controller. Until then, `getSelected` etc. still work because
    // the Pref is the source of truth (no DOM dependency).
    return { mount, getSelected, serialize, clear, setSelected, matches };
}

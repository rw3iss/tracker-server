/**
 * pickers.js — registry of toolbar multi-select pickers + a single
 * mount entry point.
 *
 * Replaces the old per-picker wrapper trio (app-picker, category-picker,
 * type-picker) and the three near-identical `tk-field` blocks in
 * `index.html`. Each picker is now a row in PICKER_DEFINITIONS — adding
 * a new one is one entry here, no HTML edit, no new file.
 *
 * The toolbar HTML for every picker is rendered into `<div
 * id="picker-toolbar" class="tk-toolbar__pickers">` (which uses
 * `display: contents` so the rendered fields participate in the
 * toolbar's flex layout as if they were direct children).
 */

import { createValuePicker } from './value-picker.js';
import { escapeHtml }        from './utils.js';

/** Closed enum that the type picker renders even when the server hasn't
 *  seen any of these values yet. Mirrors the `EventType` union. */
const EVENT_TYPES = ['error', 'warning', 'info', 'debug', 'event'];

/**
 * One row per toolbar picker. Adding a new field-based picker (status
 * multi-select, environment, etc.) is a single entry here.
 *
 * @typedef {Object} PickerDef
 * @property {string} id            Stable lookup key (used as the controllers map key).
 * @property {string} fieldLabel    Above-the-button text (e.g. "Apps").
 * @property {string} buttonId      DOM id for the toggle button.
 * @property {string} panelId       DOM id for the popover panel.
 * @property {string} field         distinct-endpoint `field=` value.
 * @property {string} prefKey       localStorage key for selection persistence.
 * @property {ReadonlyArray<string>} [staticValues]
 *           Closed enum to render, even before the server reports counts.
 * @property {object} labels        Forwarded to createValuePicker.
 */

/** @type {ReadonlyArray<PickerDef>} */
export const PICKER_DEFINITIONS = [
    {
        id:          'apps',
        fieldLabel:  'Apps',
        buttonId:    'btn-appids-toggle',
        panelId:     'appids-panel',
        field:       'appId',
        prefKey:     'filter:appIds',
        labels: {
            all:               'All apps',
            singular:          'app',
            plural:            'apps',
            searchPlaceholder: 'Search apps…',
        },
    },
    {
        id:          'categories',
        fieldLabel:  'Categories',
        buttonId:    'btn-categories-toggle',
        panelId:     'categories-panel',
        field:       'category',
        prefKey:     'filter:categories',
        labels: {
            all:               'All categories',
            singular:          'category',
            plural:            'categories',
            searchPlaceholder: 'Search categories…',
        },
    },
    {
        id:           'types',
        fieldLabel:   'Types',
        buttonId:     'btn-types-toggle',
        panelId:      'types-panel',
        field:        'type',
        staticValues: EVENT_TYPES,
        prefKey:      'filter:types',
        labels: {
            all:               'All types',
            singular:          'type',
            plural:            'types',
            searchPlaceholder: 'Search types…',
        },
    },
];

/**
 * Render the picker fields into the host container and mount each
 * controller. Returns a map keyed by `def.id` so callers can do
 * `pickers.apps.serialize()` etc.
 *
 * @param {HTMLElement} host  Container with `display: contents` — the
 *                            fields will appear as direct toolbar children.
 * @returns {Record<string, ReturnType<ReturnType<typeof createValuePicker>['mount']>>}
 */
export function mountPickerToolbar(host) {
    if (!host) return {};

    host.innerHTML = PICKER_DEFINITIONS.map(renderPickerField).join('');

    const controllers = {};
    for (const def of PICKER_DEFINITIONS) {
        controllers[def.id] = createValuePicker({
            field:        def.field,
            staticValues: def.staticValues,
            prefKey:      def.prefKey,
            buttonId:     def.buttonId,
            panelId:      def.panelId,
            labels:       def.labels,
        }).mount();
    }
    return controllers;
}

/** Toolbar markup for a single picker. Matches the layout the static
 *  HTML used to ship: label → toggle button → empty popover panel. */
function renderPickerField(def) {
    return `
        <div class="tk-field">
            <label for="${escapeHtml(def.buttonId)}">${escapeHtml(def.fieldLabel)}</label>
            <button id="${escapeHtml(def.buttonId)}" class="tk-btn tk-btn--toggle">${escapeHtml(def.labels.all)}</button>
            <div id="${escapeHtml(def.panelId)}" class="tk-popover" hidden></div>
        </div>`;
}

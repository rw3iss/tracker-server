/**
 * summary/grouping.js — pure grouping logic for the Summary panel.
 *
 * Two grouping modes:
 *   • 'type'  → outer key is EventType ('error', 'warning', …),
 *                inner key is appId.
 *   • 'appId' → outer key is appId, inner key is EventType.
 *
 * Caches the most recent computation, keyed on `(eventsRef, mode)`. Every
 * mutator in `state.js` produces a fresh events array, so reference equality
 * is enough to invalidate — we don't have to deep-compare or hash 1000s of
 * events on every redraw.
 *
 * Pure functions only — no DOM, no state imports.
 */

const EVENT_TYPES = ['error', 'warning', 'info', 'debug', 'event'];

let cache = { eventsRef: null, mode: null, value: null };

/**
 * Group events for the Summary view.
 *
 * @param {any[]}              events  Source events.
 * @param {'type'|'appId'}     mode    Outer grouping key.
 * @returns {{
 *   outerKeys:  string[],
 *   innerKeys:  string[],
 *   counts:     Record<string, Record<string, number>>,
 *   totals:     Record<string, number>,
 * }}
 */
export function groupEvents(events, mode) {
    if (cache.eventsRef === events && cache.mode === mode) return cache.value;

    const outerOf = mode === 'type'  ? e => e.type  || 'event'
                                     : e => e.appId || '(unknown)';
    const innerOf = mode === 'type'  ? e => e.appId || '(unknown)'
                                     : e => e.type  || 'event';

    const counts  = {};
    const innerSet = new Set();
    const outerSet = new Set();
    const totals  = {};

    for (const ev of events) {
        const outer = outerOf(ev);
        const inner = innerOf(ev);
        outerSet.add(outer);
        innerSet.add(inner);
        if (!counts[outer]) counts[outer] = {};
        counts[outer][inner] = (counts[outer][inner] ?? 0) + 1;
        totals[outer] = (totals[outer] ?? 0) + 1;
    }

    // Stable order: in 'type' mode, force the canonical event-type order so
    // dashboards reading left-to-right always see error → warning → info →
    // debug → event. AppId order is alphabetical so the same app stays in
    // the same colour slot redraw to redraw.
    const outerKeys = mode === 'type'
        ? EVENT_TYPES.filter(t => outerSet.has(t)).concat(
              [...outerSet].filter(k => !EVENT_TYPES.includes(k)).sort(),
          )
        : [...outerSet].sort();
    const innerKeys = mode === 'appId'
        ? EVENT_TYPES.filter(t => innerSet.has(t)).concat(
              [...innerSet].filter(k => !EVENT_TYPES.includes(k)).sort(),
          )
        : [...innerSet].sort();

    const value = { outerKeys, innerKeys, counts, totals };
    cache = { eventsRef: events, mode, value };
    return value;
}


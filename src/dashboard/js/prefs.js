/**
 * prefs.js — typed view-state preferences backed by localStorage.
 *
 * Each preference owns:
 *   • a stable key (namespaced, e.g. 'table:columnWidths'),
 *   • a default value used when nothing is stored *or* when the stored
 *     value can't be parsed,
 *   • optional shape validation via a `validate(value)` function.
 *
 * The API is deliberately simple — `get()` reads, `set()` writes, `reset()`
 * removes — so consumers can drop a `Pref` in anywhere they used to call
 * `ls.get(...)` directly.
 *
 * Why a class instead of plain calls:
 *   1. The default lives next to the key, so there's no chance a reader
 *      and a writer disagree on the fallback.
 *   2. Validation runs on read — if a stored value drifts (older schema,
 *      manual tampering), the reader gets the default rather than a
 *      half-broken object.
 *   3. Subscribers can react to changes via `on(handler)`.
 *
 * Usage pattern (each module declares its own constant Prefs at top):
 *
 *   const PREF_VISIBLE_COLUMNS = new Pref('table:visibleColumns', null);
 *   const PREF_COLUMN_WIDTHS   = new Pref('table:columnWidths', {});
 *
 *   const widths = PREF_COLUMN_WIDTHS.get();
 *   PREF_COLUMN_WIDTHS.set({ ...widths, message: 480 });
 */

import { ls } from './storage.js';

const subscribers = new Map(); // key -> Set<handler>

export class Pref {
    /**
     * @param {string} key   Stable storage key. Namespace with a colon
     *                       (e.g. 'table:columnWidths') to avoid collisions.
     * @param {*}      defaultValue Value returned when nothing is stored.
     * @param {object} [opts]
     * @param {(value: any) => boolean} [opts.validate]
     *   Optional shape check. If it returns falsy on read, the default
     *   is returned instead — protects against schema drift.
     */
    constructor(key, defaultValue, opts = {}) {
        this.key      = key;
        this.default  = defaultValue;
        this.validate = opts.validate ?? (() => true);
    }

    /** Read the stored value, or the default. Always defined. */
    get() {
        const stored = ls.get(this.key, undefined);
        if (stored === undefined) return clone(this.default);
        try {
            if (!this.validate(stored)) return clone(this.default);
            return stored;
        } catch {
            return clone(this.default);
        }
    }

    /** Write a value and notify subscribers. */
    set(value) {
        ls.set(this.key, value);
        const subs = subscribers.get(this.key);
        if (subs) for (const fn of subs) try { fn(value); } catch { /* swallow */ }
    }

    /**
     * Read-modify-write helper. Useful for object/dictionary prefs:
     *   PREF_COLUMN_WIDTHS.update(w => ({ ...w, message: 480 }));
     */
    update(producer) {
        const next = producer(this.get());
        this.set(next);
        return next;
    }

    /** Remove the stored value (next read returns the default). */
    reset() {
        ls.remove(this.key);
        const subs = subscribers.get(this.key);
        if (subs) for (const fn of subs) try { fn(this.default); } catch {}
    }

    /** Subscribe to writes. Returns an unsubscribe function. */
    on(handler) {
        if (!subscribers.has(this.key)) subscribers.set(this.key, new Set());
        subscribers.get(this.key).add(handler);
        return () => subscribers.get(this.key)?.delete(handler);
    }
}

/** Defensive copy so callers never mutate the default in place. */
function clone(v) {
    if (v == null || typeof v !== 'object') return v;
    try { return structuredClone(v); }
    catch { return JSON.parse(JSON.stringify(v)); }
}

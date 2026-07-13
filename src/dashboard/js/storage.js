/**
 * storage.js — typed wrapper around `localStorage` with a "tracker:" namespace.
 *
 * Why a wrapper: keeps every subsystem's persistence calls aligned (same
 * keys, same JSON serialisation, same swallowed errors when storage is
 * disabled), and lets us nuke all dashboard state in one call when needed.
 */

const NS = 'tracker:';

export const ls = {
    get(key, fallback) {
        try {
            const raw = localStorage.getItem(NS + key);
            return raw == null ? fallback : JSON.parse(raw);
        } catch {
            return fallback;
        }
    },
    set(key, value) {
        try {
            localStorage.setItem(NS + key, JSON.stringify(value));
        } catch {
            // Quota / private mode — silently drop.
        }
    },
    remove(key) {
        try { localStorage.removeItem(NS + key); } catch {}
    },
};

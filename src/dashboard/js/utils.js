/**
 * utils.js — small pure helpers used across the dashboard.
 * No side effects, no DOM, no globals — safe to import anywhere.
 */

/** Format a Unix-ms timestamp as a relative phrase: "5s ago", "3h ago". */
export function relativeTime(ms) {
    if (!ms && ms !== 0) return '';
    const diff = Date.now() - ms;
    if (diff < 0)        return 'in the future';
    if (diff < 5_000)    return 'just now';
    if (diff < 60_000)   return Math.floor(diff /     1_000) + 's ago';
    if (diff < 3_600_000) return Math.floor(diff /    60_000) + 'm ago';
    if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + 'h ago';
    return Math.floor(diff / 86_400_000) + 'd ago';
}

/** Format a Unix-ms timestamp as an ISO-ish wall clock. */
export function formatDateTime(ms) {
    if (!ms && ms !== 0) return '';
    const d = new Date(ms);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
           `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Truncate a string with an ellipsis. Returns '' for nullish inputs. */
export function truncate(str, n) {
    if (str == null) return '';
    const s = String(str);
    return s.length > n ? s.slice(0, n) + '…' : s;
}

/** Cheap HTML-escape for safe innerHTML composition. */
export function escapeHtml(value) {
    if (value == null) return '';
    return String(value).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

/** Stable hash of a primitive-only object. Good enough for cache keys. */
export function hashShape(obj) {
    return JSON.stringify(obj, Object.keys(obj).sort());
}

/**
 * Deterministic colour from an arbitrary key. Used for the chart legend so
 * the same appId / type always renders the same hue across redraws.
 *
 * Strategy: hash → HSL with rotating hue, fixed saturation/lightness so all
 * colours sit in a complementary range. Reserved palette for the well-known
 * EventTypes so they look right in default mode.
 */
const TYPE_COLORS = {
    error:   '#ef4444',
    warning: '#f59e0b',
    info:    '#3b82f6',
    debug:   '#8b5cf6',
    event:   '#10b981',
};

export function colorFor(key) {
    if (TYPE_COLORS[key]) return TYPE_COLORS[key];
    // FNV-1a-ish hash → hue
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) {
        h ^= key.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    const hue = Math.abs(h) % 360;
    return `hsl(${hue}, 60%, 55%)`;
}

/** Compare-fn factory for table sort. Handles numbers, strings, undefined. */
export function comparator(accessor, dir = 'asc') {
    const sign = dir === 'asc' ? 1 : -1;
    return (a, b) => {
        const va = accessor(a);
        const vb = accessor(b);
        if (va == null && vb == null) return 0;
        if (va == null) return  1;             // nulls always last
        if (vb == null) return -1;
        if (typeof va === 'number' && typeof vb === 'number') {
            return (va - vb) * sign;
        }
        return String(va).localeCompare(String(vb), undefined, { sensitivity: 'base' }) * sign;
    };
}

/** Bucket events into discrete time-slots for line charts. */
export function bucketByTime(events, bucketMs, accessor = e => e.receivedAt || e.timestamp) {
    if (!events.length) return [];
    let min = Infinity, max = -Infinity;
    for (const e of events) {
        const t = accessor(e);
        if (t < min) min = t;
        if (t > max) max = t;
    }
    const start = Math.floor(min / bucketMs) * bucketMs;
    const end   = Math.ceil(max  / bucketMs) * bucketMs;
    const buckets = [];
    for (let t = start; t <= end; t += bucketMs) buckets.push({ t, count: 0 });
    return buckets;
}

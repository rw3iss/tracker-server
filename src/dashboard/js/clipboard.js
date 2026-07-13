/**
 * clipboard.js — shared icon SVGs + the flash-on-success helper used by
 * every "copy" button across the dashboard.
 *
 * Two callers today:
 *   • detail.js — wires the title-adjacent whole-event copy button.
 *   • detail-pretty.js — wires per-field + per-column copy buttons.
 *
 * Both want the same UX: a tiny clipboard icon, click → text on the
 * clipboard → icon briefly swaps to a green checkmark, then back. The
 * SVG strings + the flash logic live here so the visuals stay
 * identical and any tweak (icon size, flash duration) ripples to all
 * call sites at once.
 */

/** Standard clipboard outline icon, 14×14 viewport-agnostic. */
export const COPY_SVG = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
    </svg>`;

/** Checkmark — same stroke style, swapped in for the copy icon while
 *  the success-flash is active. */
export const CHECK_SVG = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="5 12 10 17 19 7"></polyline>
    </svg>`;

/**
 * Briefly swap a copy button's icon to a checkmark and tint it with
 * the success colour. The original innerHTML is restored after `ms`.
 *
 * Idempotent — calling while already in flash state is a no-op so a
 * rapid double-click doesn't permanently strand the button on the
 * checkmark icon.
 */
export function flashCopySuccess(btn, ms = 1200) {
    if (btn.classList.contains('is-copied')) return;
    const orig = btn.innerHTML;
    btn.classList.add('is-copied');
    btn.innerHTML = CHECK_SVG;
    setTimeout(() => {
        btn.classList.remove('is-copied');
        btn.innerHTML = orig;
    }, ms);
}

/**
 * Build a clipboard icon button, wire its click handler, and return
 * the element. `textOrFn` is either the literal string to copy or a
 * function returning the string at copy time (handy when the value
 * can change between renders).
 *
 * @param {string | (() => string)} textOrFn
 * @param {object} [opts]
 * @param {string} [opts.className]   Extra class. The shared
 *                                     `.tk-pretty__copy` is always
 *                                     applied so the visual style
 *                                     stays uniform.
 * @param {string} [opts.label]       aria-label / title for the button.
 */
export function makeCopyButton(textOrFn, opts = {}) {
    const btn = document.createElement('button');
    btn.type      = 'button';
    btn.className = `tk-pretty__copy${opts.className ? ' ' + opts.className : ''}`;
    btn.title     = opts.label ?? 'Copy';
    btn.setAttribute('aria-label', opts.label ?? 'Copy');
    btn.innerHTML = COPY_SVG;
    btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const text = typeof textOrFn === 'function' ? textOrFn() : textOrFn;
        try {
            await navigator.clipboard.writeText(text ?? '');
            flashCopySuccess(btn);
        } catch { /* clipboard denied — silent */ }
    });
    return btn;
}

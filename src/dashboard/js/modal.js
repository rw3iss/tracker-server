/**
 * modal.js — generic modal component.
 *
 * Single-instance: a second `showModal()` call replaces the first. That
 * matches the dashboard's UX (we never need stacked dialogs), and saves
 * us from tracking a stack of overlays + their cleanup hooks.
 *
 * Usage:
 *
 *   showModal({
 *     title:    'Heading',
 *     bodyHTML: '<p>Some content</p>',  // OR bodyEl: HTMLElement,
 *     okText:   'OK',
 *     onOk:     () => { ... },
 *     // Optional:
 *     cancelText: 'Cancel',
 *     onCancel:   () => { ... },
 *     showClose:  true,                 // header × button (default true)
 *     onClose:    () => { ... },
 *     width:      '65vw',               // CSS value
 *     height:     '70vh',
 *     dismissOnEsc: true,               // default true
 *     dismissOnOverlayClick: true,      // default true
 *   });
 *
 * `closeModal()` programmatically dismisses. All button/close handlers
 * close automatically after invoking the user callback.
 */

import { escapeHtml } from './utils.js';

let activeOverlay = null;
let activeCleanup = null;

export function showModal(opts = {}) {
    closeModal();

    const overlay = document.createElement('div');
    overlay.className = 'tk-modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'tk-modal';
    if (opts.width)  dialog.style.width  = opts.width;
    if (opts.height) dialog.style.height = opts.height;

    const showClose = opts.showClose !== false;

    dialog.innerHTML = `
        <div class="tk-modal__header">
            <h3 class="tk-modal__title">${escapeHtml(opts.title || '')}</h3>
            ${showClose ? `<button class="tk-modal__close" type="button" aria-label="Close">&times;</button>` : ''}
        </div>
        <div class="tk-modal__body"></div>
        <div class="tk-modal__footer">
            ${opts.cancelText ? `<button class="tk-btn" type="button" data-action="cancel">${escapeHtml(opts.cancelText)}</button>` : ''}
            <button class="tk-btn tk-btn--primary" type="button" data-action="ok">${escapeHtml(opts.okText || 'OK')}</button>
        </div>
    `;

    const bodyEl = dialog.querySelector('.tk-modal__body');
    if (opts.bodyEl)        bodyEl.appendChild(opts.bodyEl);
    else if (opts.bodyHTML) bodyEl.innerHTML = opts.bodyHTML;

    const dismiss = (cb) => {
        // Run the callback first; if it throws, still tear the modal down.
        try { cb?.(); } finally { closeModal(); }
    };

    dialog.querySelector('[data-action="ok"]')
          ?.addEventListener('click', () => dismiss(opts.onOk));
    dialog.querySelector('[data-action="cancel"]')
          ?.addEventListener('click', () => dismiss(opts.onCancel));
    dialog.querySelector('.tk-modal__close')
          ?.addEventListener('click', () => dismiss(opts.onClose));

    if (opts.dismissOnOverlayClick !== false) {
        overlay.addEventListener('click', e => {
            if (e.target === overlay) dismiss(opts.onClose);
        });
    }

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    let onKey = null;
    if (opts.dismissOnEsc !== false) {
        onKey = e => { if (e.key === 'Escape') dismiss(opts.onClose); };
        document.addEventListener('keydown', onKey);
    }

    activeOverlay = overlay;
    activeCleanup = () => { if (onKey) document.removeEventListener('keydown', onKey); };
}

export function closeModal() {
    if (!activeOverlay) return;
    try { activeCleanup?.(); } catch { /* never throw out of teardown */ }
    activeOverlay.remove();
    activeOverlay = null;
    activeCleanup = null;
}

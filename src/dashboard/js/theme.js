/**
 * theme.js — light/dark theme controller for the dashboard.
 *
 * The actual paint-time theme application happens in an inline script
 * in `<head>` (see index.html) so the page never flashes the wrong
 * palette while this module loads. This file owns:
 *
 *   • The persistence ↔ DOM-attribute round-trip after first paint.
 *   • The toggle button wiring.
 *   • A small bus event so other components (e.g. Mermaid in docs,
 *     Chart.js in summary) can react if they want.
 *
 * Persisted as `tracker:ui:theme` ('light' | 'dark' | null). `null`
 * means "follow the OS preference" — useful for shared kiosks.
 */

import { Pref } from './prefs.js';
import { bus }  from './state.js';

const PREF_THEME = new Pref('ui:theme', null);

/** The inline `<head>` script writes this attribute before paint. */
function readActiveTheme() {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** Apply a theme to the DOM + persist the choice. */
export function setTheme(theme) {
    if (theme !== 'dark' && theme !== 'light') theme = 'light';
    document.documentElement.dataset.theme = theme;
    PREF_THEME.set(theme);
    syncToggleAria(theme);
    bus.emit('theme:changed', theme);
}

/** Reflect the current theme on the toggle button so screen readers
 *  hear "pressed" when dark is active. Idempotent — safe to call
 *  before the button mounts. */
function syncToggleAria(theme) {
    const btn = document.getElementById('btn-theme-toggle');
    if (btn) btn.setAttribute('aria-pressed', String(theme === 'dark'));
}

/** Flip between light and dark. */
export function toggleTheme() {
    setTheme(readActiveTheme() === 'dark' ? 'light' : 'dark');
}

/** Get the currently-active theme. Reads the DOM, not the pref. */
export function getActiveTheme() {
    return readActiveTheme();
}

/**
 * Wire the toggle button. The button needs both a sun and a moon
 * icon as children — CSS shows whichever matches the current theme.
 *
 * Returns a teardown function for tests.
 */
export function mountThemeToggle() {
    const btn = document.getElementById('btn-theme-toggle');
    if (!btn) return () => {};
    syncToggleAria(readActiveTheme());
    const onClick = () => toggleTheme();
    btn.addEventListener('click', onClick);
    return () => btn.removeEventListener('click', onClick);
}

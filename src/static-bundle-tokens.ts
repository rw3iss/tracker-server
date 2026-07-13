/**
 * DI tokens for the static-bundle controllers (dashboard, docs).
 *
 * Lives in its own file (instead of next to the module that
 * registers them) because both the controller and the module need
 * to import the token. Co-locating the symbol with the module would
 * create a circular import — the controller's `@Inject(SYMBOL)`
 * decorator runs at class-declaration time, *before* the module's
 * exports finish being evaluated, so SYMBOL would be `undefined`
 * and Nest would fail to construct the controller at boot.
 *
 * Keeping these here means the controllers can import the token
 * without ever touching the module file.
 */
export const DASHBOARD_MOUNT_PATH = Symbol('TRACKER_DASHBOARD_MOUNT_PATH');
/**
 * Configured API route prefix (e.g. `/api`, `/tracker`) — injected
 * into the dashboard's index.html at request time so the in-page
 * config knows how to build absolute API URLs without relying on the
 * `?prefix=` query param. Always carries a leading slash; never
 * trailing (`/api`, never `/api/`).
 */
export const DASHBOARD_API_PREFIX = Symbol('TRACKER_DASHBOARD_API_PREFIX');
/**
 * Auto-update mode for the dashboard. Substituted into `{{UPDATE_MODE}}`
 * in index.html and read at boot by `auto-update.js`. Three values:
 *
 *   - `'false'` — skip the version check entirely. The "Changes" button
 *                 still works as a manual viewer.
 *   - `'auto'`  — silent update: clear stale storage and re-stamp the
 *                 version, but don't show the modal.
 *   - `'modal'` — current behaviour: clear, re-stamp, and surface the
 *                 changelog modal so the user sees what they got.
 *
 * Default is `'modal'` (back-compat with deployments that don't set
 * the env var).
 */
export const DASHBOARD_UPDATE_MODE = Symbol('TRACKER_DASHBOARD_UPDATE_MODE');
export const DOCS_MOUNT_PATH      = Symbol('TRACKER_DOCS_MOUNT_PATH');

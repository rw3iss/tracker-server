import { DynamicModule, Module } from '@nestjs/common';
import { PATH_METADATA }         from '@nestjs/common/constants';
import { TrackerDashboardController } from './TrackerDashboardController';
import { normalizeMount }             from './static-bundle';
import { DASHBOARD_MOUNT_PATH, DASHBOARD_API_PREFIX, DASHBOARD_UPDATE_MODE } from './static-bundle-tokens';

// Re-export so existing import paths keep working.
export { DASHBOARD_MOUNT_PATH, DASHBOARD_API_PREFIX, DASHBOARD_UPDATE_MODE };

/**
 * Mounts {@link TrackerDashboardController} at the configured path when
 * dashboard serving is enabled. Pattern matches {@link TrackerDocsModule}
 * — when disabled the module returns no controllers, so the route
 * simply doesn't exist (cleaner ops than a controller-issued 404).
 *
 * Configured via env in `app.module.ts`:
 *   DASHBOARD_ENABLED   default true
 *   DASHBOARD_PATH      default 'dashboard' — also accepts '/' or '' to mount at root
 *
 * The dashboard itself is a static HTML/CSS/JS bundle under
 * `src/dashboard/` — copied to `dist/dashboard/` by the postbuild step.
 */
/**
 * Resolve the `TRACKER_DASHBOARD_UPDATE_MODE` env value to one of the
 * three modes the dashboard JS understands. Forgiving on input —
 * `true`, `'true'`, `'1'`, `'yes'`, `'auto'` all collapse to `'auto'`;
 * `false`, `'false'`, `'0'`, `'no'`, `'off'` all collapse to `'false'`;
 * everything else (including unset) falls back to the default
 * `'modal'`.
 */
function normalizeUpdateMode(raw: unknown): 'false' | 'auto' | 'modal' {
    if (raw === undefined || raw === null) return 'modal';
    const s = String(raw).trim().toLowerCase();
    if (s === '')                                                return 'modal';
    if (['false', '0', 'no', 'off', 'disabled'].includes(s))     return 'false';
    if (['auto', 'true', '1', 'yes', 'on', 'silent'].includes(s)) return 'auto';
    if (s === 'modal')                                           return 'modal';
    return 'modal';
}

@Module({})
export class TrackerDashboardModule {
    /**
     * @param opts.enabled  When false, no controllers are registered.
     * @param opts.path     Mount path. Default `'dashboard'`. Supports
     *                      `'/'` or `''` to mount at the host root,
     *                      which lets a deployment serve the dashboard
     *                      directly at e.g. `https://tracker.example.com`.
     *                      Leading / trailing slashes are normalised.
     */
    static register(
        opts: { enabled: boolean; path?: string; apiPrefix?: string; updateMode?: string } = { enabled: true },
    ): DynamicModule {
        if (!opts.enabled) {
            return { module: TrackerDashboardModule, controllers: [] };
        }

        const { route, urlBase } = normalizeMount(opts.path ?? 'dashboard');

        // Normalize apiPrefix the same way: leading slash, no trailing
        // slash. The controller substitutes this into the in-page config
        // so JS code can build absolute API URLs without hardcoding `/api`.
        const rawApi    = (opts.apiPrefix ?? 'api').trim();
        const stripped  = rawApi.replace(/^\/+/, '').replace(/\/+$/, '');
        const apiPrefix = stripped.length > 0 ? '/' + stripped : '';

        // Update-mode normalization. We accept a few synonyms so the
        // env var is forgiving — `true` reads as "update silently",
        // `false` / `off` / `0` as "don't check". Anything else falls
        // back to `'modal'` (the default behaviour).
        const updateMode = normalizeUpdateMode(opts.updateMode);

        // Override the @Controller('dashboard') decorator metadata so
        // the mount path is the env-configured one. Same trick the
        // docs module uses.
        Reflect.defineMetadata(PATH_METADATA, route, TrackerDashboardController);

        return {
            module:      TrackerDashboardModule,
            controllers: [TrackerDashboardController],
            // Inject the URL base into the controller so it knows what
            // prefix to strip off asset URLs and what string to
            // substitute for `{{BASE}}` in index.html. This is what
            // makes root-mount work — the controller can no longer
            // assume the first URL segment is its own mount prefix.
            providers:   [
                { provide: DASHBOARD_MOUNT_PATH,  useValue: urlBase    },
                { provide: DASHBOARD_API_PREFIX,  useValue: apiPrefix  },
                { provide: DASHBOARD_UPDATE_MODE, useValue: updateMode },
            ],
        };
    }
}

import { DynamicModule, Module } from '@nestjs/common';
import { PATH_METADATA }         from '@nestjs/common/constants';
import { TrackerDocsController } from './TrackerDocsController';
import { normalizeMount }        from './static-bundle';
import { DOCS_MOUNT_PATH }       from './static-bundle-tokens';

// Re-export so existing import paths keep working.
export { DOCS_MOUNT_PATH };

/**
 * Mounts {@link TrackerDocsController} at the configured path when docs
 * serving is enabled. When disabled the module returns no controllers,
 * so there's no route at all — `/docs` (or whatever path) returns 404.
 *
 * Configured via env in `app.module.ts`:
 *   DOCS_ENABLED   default true
 *   DOCS_PATH      default 'docs' — also accepts '/' or '' to mount at root
 *
 * The static bundle is built separately (`pnpm docs:build`) — this
 * module only deals with serving. Missing build → controller returns a
 * one-line JSON hint instead of crashing.
 */
@Module({})
export class TrackerDocsModule {
    /**
     * @param opts.enabled  When false, no controllers are registered.
     * @param opts.path     Mount path. Default `'docs'`. Supports `'/'`
     *                      or `''` for a root-mount deploy. Leading /
     *                      trailing slashes are normalised.
     */
    static register(opts: { enabled: boolean; path?: string } = { enabled: true }): DynamicModule {
        if (!opts.enabled) {
            return { module: TrackerDocsModule, controllers: [] };
        }

        const { route, urlBase } = normalizeMount(opts.path ?? 'docs');

        // Override the @Controller('docs') decorator metadata so the
        // mount path is the env-configured one. Same trick the
        // TrackerModule uses for routePrefix.
        Reflect.defineMetadata(PATH_METADATA, route, TrackerDocsController);

        return {
            module:      TrackerDocsModule,
            controllers: [TrackerDocsController],
            providers:   [{ provide: DOCS_MOUNT_PATH, useValue: urlBase }],
        };
    }
}

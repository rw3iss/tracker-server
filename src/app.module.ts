import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TrackerModule } from '@rw3iss/tracker/consumer';
import {
	EventStoragePlugin,
	QueuedStoragePlugin,
	RedisIngestConsumer,
	DataSourceTrackerStorage,
	ensureTrackerTable,
} from '@rw3iss/tracker/storage';
import { DataSource } from 'typeorm';
import { TrackerDocsModule }       from './TrackerDocsModule';
import { TrackerDashboardModule }  from './TrackerDashboardModule';
import { TrackerRobotsController } from './TrackerRobotsController';
import { normalizeMount }          from './static-bundle';

// Docs serving — Astro Starlight build under `tracker-server/docs/dist`.
// Toggled by env so privacy-conscious deployments can omit the route entirely.
const docsEnabled = process.env.DOCS_ENABLED !== 'false';
const docsPath    = process.env.DOCS_PATH ?? 'docs';

// Dashboard serving — same toggle pattern as docs. False skips the
// controller entirely so the route doesn't exist (cleaner than a
// controller-issued 404). The dashboard source lives under
// `src/dashboard/` and is copied to `dist/dashboard/` by postbuild.
//
// `DASHBOARD_PATH` accepts `'/'` or `''` to mount the dashboard at the
// host root (e.g. `https://tracker.example.com` serves the dashboard
// directly). The router will catch `/api/*` and `/docs/*` first via
// route specificity, so root-mount doesn't shadow them — but two
// surfaces can't both claim the same mount, hence the validation
// below.
const dashboardEnabled    = process.env.DASHBOARD_ENABLED !== 'false';
const dashboardPath       = process.env.DASHBOARD_PATH ?? 'dashboard';
// Auto-update mode for the dashboard. `false` | `auto` | `modal`,
// normalized inside TrackerDashboardModule. Default is `modal`.
const dashboardUpdateMode = process.env.TRACKER_DASHBOARD_UPDATE_MODE;

// Fail fast if the user pointed two surfaces at the same mount —
// that's an unrecoverable config error (Nest would silently let one
// shadow the other and the symptom is invisible until someone visits
// the wrong surface).
if (docsEnabled && dashboardEnabled) {
    const docsMount      = normalizeMount(docsPath).urlBase      || '/';
    const dashboardMount = normalizeMount(dashboardPath).urlBase || '/';
    if (docsMount === dashboardMount) {
        throw new Error(
            `[tracker-server] DOCS_PATH and DASHBOARD_PATH both resolve to '${docsMount}'. ` +
            `Set one to a different mount (or DOCS_ENABLED=false / DASHBOARD_ENABLED=false).`,
        );
    }
}

// Admin endpoints (currently `POST /api/admin/clear-events`). Mounted
// only when TRACKER_ADMIN_KEY is set — without a key the route is 404.
// Distinct from TRACKER_API_KEYS (ingest auth) on purpose; admin ops
// have a different threat model.
const adminKey   = process.env.TRACKER_ADMIN_KEY || undefined;
const routePrefix = process.env.ROUTE_PREFIX ?? 'api';

@Module({
	// Always-on root-level controllers (independent of which UI surface
	// is mounted at `/`). TrackerRobotsController guarantees that
	// `/robots.txt` returns a blanket Disallow even when the dashboard
	// is the homepage and would otherwise catch the request via its
	// wildcard route. Explicit routes outrank wildcards in Fastify so
	// `/robots.txt` always hits this controller.
	controllers: [TrackerRobotsController],

	imports: [
		TypeOrmModule.forRootAsync({
			useFactory: () => ({
				type: 'postgres' as const,
				host: process.env.DB_HOST || 'localhost',
				port: parseInt(process.env.DB_PORT || '5432', 10),
				username: process.env.DB_USER || 'postgres',
				password: process.env.DB_PASS || 'postgres',
				database: process.env.DB_NAME || 'tracker',
				ssl: process.env.DB_SSL !== 'false' && process.env.NODE_ENV === 'production'
				? { rejectUnauthorized: false } : false,
				synchronize: false,
				logging: process.env.NODE_ENV !== 'production',
			}),
		}),

		TrackerDocsModule.register({      enabled: docsEnabled,      path: docsPath }),
		TrackerDashboardModule.register({
			enabled:   dashboardEnabled,
			path:      dashboardPath,
			// Inline the configured API prefix into the dashboard's
			// index.html so the in-page config (window.__TRACKER_DASHBOARD_CONFIG__)
			// matches what the consumer actually serves on. Without this
			// the dashboard would default to `/api` and silently break
			// against deployments configured with `ROUTE_PREFIX=tracker`.
			apiPrefix:  routePrefix,
			updateMode: dashboardUpdateMode,
		}),

		TrackerModule.registerAsync({
			adminKey,
			routePrefix,
			inject: [DataSource],
			useFactory: async (ds: DataSource) => {
				await ensureTrackerTable(ds);
				const storage = new DataSourceTrackerStorage(ds);
				const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

				const useQueue = process.env.USE_QUEUE !== 'false';

				const storagePlugin = useQueue
					? await QueuedStoragePlugin.create({
						redis: redisUrl,
						storage,
						batchSize: 100,
						concurrency: 2,
					})
					: EventStoragePlugin.create(storage);

				const plugins: any[] = [storagePlugin];

				// Consume events from the Go ingest server's Redis LIST
				if (process.env.ENABLE_INGEST_CONSUMER !== 'false') {
					plugins.push(
						RedisIngestConsumer.create({
							redis: redisUrl,
							listKey: process.env.REDIS_LIST_KEY || 'tracker:ingest',
							batchSize: 100,
							pollIntervalMs: 500,
						}),
					);
				}

				// Pass the raw env value through. The package's TrackerController
				// understands comma-, newline-, and whitespace-separated lists
				// and skips lines beginning with `#` so the env file can carry
				// an annotated multi-line key list. Doing the split here would
				// break the multi-line form.
				const apiKeys = process.env.TRACKER_API_KEYS && process.env.TRACKER_API_KEYS.trim()
					? process.env.TRACKER_API_KEYS
					: undefined;

				// Route prefix for the API endpoints (events, metrics, status, ...).
				// Dashboard lives independently at DASHBOARD_PATH. Typical prod setup:
				// tracker.ryanweiss.net/api/*  and  tracker.ryanweiss.net/dashboard.
				// Cache TTL for GET /api/events/distinct (the dashboard's
				// app-picker source). Defaults to 60s; set to 0 to disable.
				const distinctCacheTtlMs = process.env.DISTINCT_CACHE_TTL_MS !== undefined
					? Math.max(0, Number(process.env.DISTINCT_CACHE_TTL_MS))
					: 60_000;

				return {
					routePrefix,
					plugins,
					deduplication: {
						enabled: true,
						windowMs: 300_000,
						// Server-side bypass is now the cross-app / emergency layer.
						// The primary opt-out is per-event (event.dedup === false),
						// which the SDK stamps from each emitter's own dedup config
						// (TrackerConfig.dedup.bypassMessages / bypassPredicate).
						// What stays here: rules that should hold regardless of
						// whether a misconfigured emitter remembers to set its
						// own policy. Right now that's just the analytics catch —
						// `type === 'event'` is intentional usage data, never noise.
						bypassDedup: (e) => e.type === 'event',
					},
					publicIngestion: true,
					apiKey: apiKeys,
					distinctCacheTtlMs,
				};
			},
		}),
	],
})
export class AppModule {}

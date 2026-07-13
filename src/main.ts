// Side-effect-only env loader — MUST be the first import.
// Lives in its own file because SWC compiles ESM `import` statements
// to `require()` calls and hoists them above any bare `require()` in
// source order. Without this dedicated file, dotenv would run AFTER
// `./app.module` had already evaluated → app.module's
// `process.env.DASHBOARD_PATH ?? 'dashboard'` defaults would win
// over the .env value. See bootstrap-env.ts for the full story.
import './bootstrap-env';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

const PORT = parseInt(process.env.PORT || '4010', 10);

async function bootstrap() {
	const app = await NestFactory.create<NestFastifyApplication>(
		AppModule,
		new FastifyAdapter({
			logger: process.env.NODE_ENV !== 'production',
			trustProxy: true,
		}),
	);

	app.enableCors({ origin: true, credentials: true });

	await app.listen(PORT, '0.0.0.0');
	console.log(`\n  Tracker server listening on http://0.0.0.0:${PORT}`);
	console.log(`  Dashboard: http://localhost:${PORT}/${process.env.DASHBOARD_PATH || 'dashboard'}\n`);
}

bootstrap();

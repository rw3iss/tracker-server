import { Controller, Get, Header, Res } from '@nestjs/common';

/**
 * Serves `/robots.txt` at the host root with a blanket Disallow.
 *
 * The dashboard, docs, and API are all internal tooling — none of them
 * should ever be indexed by a search crawler. Three layers protect that:
 *
 *   1. This controller — `/robots.txt` returns `Disallow: /` for any
 *      User-agent. Mounted unconditionally so it works regardless of
 *      where the dashboard lives, even when DASHBOARD_PATH=/ catches
 *      every other path via its wildcard route. NestJS / Fastify prefer
 *      explicit routes over wildcards, so `/robots.txt` always hits us
 *      first.
 *
 *   2. The dashboard's index.html carries `<meta name="robots"
 *      content="noindex,nofollow">` (set in src/dashboard/index.html).
 *      Defends against crawlers that ignore robots.txt.
 *
 *   3. The Starlight docs site has the same meta in its global head
 *      config (astro.config.mjs).
 *
 * No `@Controller(...)` argument → mounted at root.
 */
@Controller()
export class TrackerRobotsController {
    @Get('robots.txt')
    @Header('Content-Type', 'text/plain; charset=utf-8')
    @Header('Cache-Control', 'public, max-age=86400')
    robots(
        @Res({ passthrough: false }) res: any, // eslint-disable-line @typescript-eslint/no-explicit-any
    ): void {
        const resRaw = res.raw ?? res;
        resRaw.writeHead(200, {
            'Content-Type':  'text/plain; charset=utf-8',
            'Cache-Control': 'public, max-age=86400',
        });
        resRaw.end(
            'User-agent: *\n' +
            'Disallow: /\n',
        );
    }
}

// astro.config.mjs
//
// Starlight config for the @rw3iss tracker platform docs.
//
// Build output: ./dist (static HTML/CSS/JS). tracker-server's
// TrackerDocsController serves this folder at the configured DOCS_PATH
// when DOCS_ENABLED=true.
//
// `base` matters because the production build is mounted under /docs,
// not at the root. Setting `base: '/docs'` makes Astro emit URLs and
// asset paths that resolve correctly behind that prefix. Override via
// the `DOCS_BASE` env var if a different path is configured on the
// server.

import { defineConfig } from 'astro/config';
import starlight  from '@astrojs/starlight';
import mermaid    from 'astro-mermaid';

const base = process.env.DOCS_BASE ?? '/docs';

export default defineConfig({
    base,

    // Trailing-slash-style URLs match Starlight's default route shape and
    // avoid the gnarly "/docs vs /docs/" relative-asset-resolution issue
    // we hit on the dashboard.
    trailingSlash: 'always',

    integrations: [
        // Render fenced ```mermaid blocks as inline SVGs at build time.
        // `autoTheme: true` swaps Mermaid's `dark` / `default` themes in
        // sync with Starlight's theme toggle.
        mermaid({
            theme:     'dark',
            autoTheme: true,
        }),

        starlight({
            title: 'rw3iss Tracker',
            description: 'Self-hosted event + error tracking — API, SDK, architecture, ops.',
            logo: { src: './src/assets/logo.svg', replacesTitle: false },
            social: [
                { icon: 'github', label: 'GitHub', href: 'https://github.com/rw3iss/tracker' },
            ],
            editLink: {
                baseUrl: 'https://github.com/rw3iss/tracker-server/edit/main/docs/',
            },
            customCss: ['./src/styles/custom.css'],

            // Override Starlight's default Head so we can inject the
            // Mermaid zoom enhancement on every docs page.
            components: {
                Head: './src/components/Head.astro',
            },

            // Sidebar — group by audience: "Concepts" for "what is this?",
            // "API" for HTTP wire format, "SDK" per language, "Operations"
            // for deploy/run, "Reference" for one-line lookup tables.
            sidebar: [
                {
                    label: 'Welcome',
                    items: [
                        { label: 'Overview',        slug: 'index' },
                        { label: 'Quick start',     slug: 'quick-start' },
                    ],
                },
                {
                    label: 'Concepts',
                    autogenerate: { directory: 'concepts' },
                },
                {
                    label: 'HTTP API',
                    autogenerate: { directory: 'api' },
                },
                {
                    label: 'SDKs',
                    autogenerate: { directory: 'sdk' },
                },
                {
                    label: 'Operations',
                    autogenerate: { directory: 'operations' },
                },
                {
                    label: 'Reference',
                    autogenerate: { directory: 'reference' },
                },
            ],
        }),
    ],
});

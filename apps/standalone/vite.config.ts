import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import license from 'rollup-plugin-license';
import { type Plugin, defineConfig } from 'vite';

/**
 * Licences a bundled package may have. Their notices must travel with every copy of the build, so
 * the build writes them all to third-party-notices.txt — and fails on anything outside this list,
 * so a copyleft or unlicensed dependency cannot slip into the editor unnoticed.
 */
const PERMISSIVE = '(MIT OR ISC OR Apache-2.0 OR BSD-2-Clause OR BSD-3-Clause OR 0BSD OR OFL-1.1)';

const notices: Plugin = {
    ...(license({
        thirdParty: {
            includePrivate: false, // our own @workspace packages: Apache-2.0, see NOTICE
            allow: { test: PERMISSIVE, failOnUnlicensed: true, failOnViolation: true },
            output: fileURLToPath(new URL('./dist/third-party-notices.txt', import.meta.url)),
        },
    }) as Plugin),
    apply: 'build',
};

// The standalone editor has no server: nothing to proxy, nothing to call.
export default defineConfig({
    // Relative URLs: the build works from any path — a domain root, GitHub Pages' /<repo>/, a folder.
    base: './',
    plugins: [react(), notices],
    server: { host: true, port: 5174 },
    preview: { host: true, port: 3001 },
});

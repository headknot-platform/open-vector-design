import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Plain Node on purpose: the format library must not depend on a DOM, so the future server
        // and the `ovd` CLI can use it. A stray `document` or `DOMParser` fails here.
        environment: 'node',
        include: ['src/**/*.test.ts'],
    },
});

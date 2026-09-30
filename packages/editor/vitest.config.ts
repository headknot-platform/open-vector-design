import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/** The editor on its own: jsdom, no server, no fake API — a test that reaches the network fails. */
export default defineConfig({
    plugins: [react()],
    test: {
        environment: 'jsdom',
        include: ['src/**/*.test.{ts,tsx}'],
        setupFiles: ['./src/test/setup.ts'],
        restoreMocks: true,
    },
});

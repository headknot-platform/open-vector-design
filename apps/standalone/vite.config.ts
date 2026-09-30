import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The standalone editor has no server: nothing to proxy, nothing to call.
export default defineConfig({
    plugins: [react()],
    server: { host: true, port: 5174 },
    preview: { host: true, port: 3001 },
});

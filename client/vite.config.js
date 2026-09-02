import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dev server proxies /api to the Express backend so the SPA and API share an
// origin (no CORS, cookies/tokens just work).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:4000' },
  },
});

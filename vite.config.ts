/// <reference types="vitest" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Served at the root of the custom domain catan.ntblabs.dev, so assets are
  // root-relative. This was '/catan-map-generator/' while the site lived at the
  // GitHub Pages project subpath. If the custom domain ever goes away, this has
  // to go back to '/<repo-name>/' or every asset 404s.
  base: '/',
  plugins: [react()],
  build: {
    rollupOptions: {
      // Two entries. legal.html is the /legal notice page and gets its own
      // bundle: GitHub Pages serves dist/legal.html at /legal, and the dev and
      // preview servers resolve /legal to legal.html the same way, so no
      // client-side router and no 404.html rewrite are involved.
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        legal: fileURLToPath(new URL('./legal.html', import.meta.url)),
      },
    },
  },
  server: {
    host: true,
    port: 5173,
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});

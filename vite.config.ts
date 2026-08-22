/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Served at the root of the custom domain catan.ntblabs.dev, so assets are
  // root-relative. This was '/catan-map-generator/' while the site lived at the
  // GitHub Pages project subpath. If the custom domain ever goes away, this has
  // to go back to '/<repo-name>/' or every asset 404s.
  base: '/',
  plugins: [react()],
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

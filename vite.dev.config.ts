import { resolve } from 'node:path';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

// Dev harness: serves src/dev.html, which runs the side panel against an
// in-memory fake of the chrome.* API (see src/mock/fakeChrome.ts).
// `npm run harness` builds it in production mode for realistic UI timings.
export default defineConfig({
  root: resolve(import.meta.dirname, 'src'),
  publicDir: resolve(import.meta.dirname, 'public'),
  plugins: [preact()],
  server: { port: 5199 },
  preview: { port: 5198 },
  build: {
    outDir: resolve(import.meta.dirname, 'dist-harness'),
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: { input: resolve(import.meta.dirname, 'src/dev.html') },
  },
});

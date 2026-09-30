import { defineConfig } from 'vite';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
// Build id: changes every build; the service worker + update prompt compare against it.
const BUILD_ID = `${pkg.version}-${Date.now().toString(36)}`;

export default defineConfig({
  server: { port: 5176, strictPort: true },
  preview: { port: 5177, strictPort: true },
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    chunkSizeWarningLimit: 1300, // phaser alone is ~1.2MB raw; it lives in its own long-cached vendor chunk
    rollupOptions: {
      output: {
        // Stable vendor chunks cache across deploys; game code churn doesn't re-download Phaser.
        manualChunks(id) {
          if (id.includes('node_modules/phaser')) return 'phaser';
          if (id.includes('node_modules/colyseus') || id.includes('node_modules/@colyseus')) return 'net';
        },
      },
    },
  },
  publicDir: 'public',
  plugins: [{
    // Stamp the build id into the service worker (public/sw.js is copied verbatim by Vite).
    name: 'wayfarer-sw-stamp',
    apply: 'build',
    closeBundle() {
      try {
        const f = 'dist/sw.js';
        const hashed = readdirSync('dist/assets').filter((n) => /\.(js|css)$/.test(n)).map((n) => `/assets/${n}`);
        writeFileSync(f, readFileSync(f, 'utf8').replace("'__PRECACHE__'", JSON.stringify(hashed)).replaceAll('__BUILD_ID__', BUILD_ID));
      } catch (e) { console.warn('sw stamp failed', e.message); }
    },
  }],
});


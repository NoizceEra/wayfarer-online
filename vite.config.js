import { defineConfig } from 'vite';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
// Build id: changes every build; the service worker + update prompt compare against it.
let outDir = 'dist';
const BUILD_ID = `${pkg.version}-${Date.now().toString(36)}`;

export default defineConfig({
  server: { port: 5176, strictPort: true },
  preview: { port: 5177, strictPort: true },
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  resolve: {
    // The game only uses Arcade physics: skip the full build's Matter.js (~200 KB raw) via Phaser's own arcade-only bundle.
    alias: [{ find: /^phaser$/, replacement: 'phaser/dist/phaser-arcade-physics.js' }],
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    chunkSizeWarningLimit: 1300, // phaser alone is ~1.2MB raw; it lives in its own long-cached vendor chunk
    rollupOptions: {
      output: {
        // Name the on-demand Solana chunk (it is only imported when the wallet panel needs RPC) so the SW can skip precaching it.
        chunkFileNames: (c) => (c.moduleIds.some((m) => m.includes('node_modules/@solana/web3.js')) ? 'assets/solana-[hash].js' : 'assets/[name]-[hash].js'),
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
    configResolved(cfg) { outDir = cfg.build.outDir; },
    closeBundle() {
      try {
        const f = `${outDir}/sw.js`;
        // Precache everything solo play needs; the multiplayer client (net-*) and Solana (solana-*) chunks are rarely used, so they
        // are cached on first use by the SW's runtime cache-first rule instead of competing with the first load.
        const hashed = readdirSync(`${outDir}/assets`).filter((n) => /\.(js|css)$/.test(n) && !/^(net|solana)-/.test(n)).map((n) => `/assets/${n}`);
        writeFileSync(f, readFileSync(f, 'utf8').replace("'__PRECACHE__'", JSON.stringify(hashed)).replaceAll('__BUILD_ID__', BUILD_ID));
      } catch (e) { console.warn('sw stamp failed', e.message); }
    },
  }],
});


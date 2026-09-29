// Tunnel-only dev config (temporary): same app, but reachable through a
// Cloudflare quick tunnel (foreign Host header). Not for production.
import { defineConfig } from 'vite';
import base from './vite.config.js';

export default defineConfig({
  ...base,
  server: {
    ...base.server,
    port: 5178,
    strictPort: true,
    host: true,
    allowedHosts: true,
  },
});

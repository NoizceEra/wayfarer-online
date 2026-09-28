import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5176, strictPort: true },
  preview: { port: 5177, strictPort: true },
  build: { outDir: 'dist', assetsDir: 'assets' },
  publicDir: 'public'
});

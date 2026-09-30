import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: false, // dist/ui is built first by vite
  banner: { js: '#!/usr/bin/env node' },
  noExternal: ['@yurt/protocol'],
  external: ['trystero', 'werift', 'ws'],
});

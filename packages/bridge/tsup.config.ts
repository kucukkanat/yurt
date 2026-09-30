import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: false, // dist/ui is built first by vite
  banner: { js: '#!/usr/bin/env node' },
  // Bundle the protocol with its pure-JS crypto deps so each import resolves from its own importer:
  // the protocol wants @noble v1, nostr-tools wants @noble v2. Leaving @noble external made Node
  // resolve both from the bridge's single copy and crash on start (ERR_PACKAGE_PATH_NOT_EXPORTED).
  noExternal: ['@yurt/protocol', 'nostr-tools', /^@noble\//, /^@scure\//],
  // Native / Node-specific packages stay real dependencies.
  external: ['trystero', 'werift', 'ws'],
});

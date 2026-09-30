import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Tests import modules directly rather than cli.ts, so load the same `ws` polyfill it does
  // (Node 22's built-in WebSocket recurses when nostr-tools closes it after a failed connect).
  test: { setupFiles: ['src/polyfill.ts'] },
});

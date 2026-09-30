import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Inlined so each simulated device can load its own Trystero instance (own selfId and room registry).
    server: { deps: { inline: ['trystero', /@trystero-p2p/] } },
    coverage: { include: ['src/**'] },
  },
});

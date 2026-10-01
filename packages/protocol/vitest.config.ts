import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Inlined so each simulated device can load its own Trystero instance (own selfId and room registry).
    server: { deps: { inline: ['trystero', /@trystero-p2p/] } },
    // Every line, branch and function of the protocol is exercised by real tests; a gap fails the run.
    coverage: {
      include: ['src/**'],
      reporter: ['text-summary'],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
    setupFiles: ['test/setup.ts'],
  },
});

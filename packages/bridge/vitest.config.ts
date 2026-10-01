import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import { PAGE_PORT } from './test/ui/fixtures.ts';

/** The fixture bridges started by test/ui/global-setup.ts, which runs in this same process. */
const fixtures = () => {
  const f = globalThis.__yurtBridgeFixtures;
  if (!f) throw new Error('the bridge fixtures are not running');
  return f;
};

// Two projects, one coverage report (istanbul works for both):
// - node: the bridge itself (src), against real agent processes, relays and sockets.
// - ui: the bridge's setup page in real Chromium, talking to a real BridgeServer started by globalSetup. No mocks.
export default defineConfig({
  plugins: [react({ include: /\.(jsx|tsx)$/ })],
  resolve: { dedupe: ['react', 'react-dom'] },
  test: {
    projects: [
      {
        extends: true,
        // Tests import modules directly rather than cli.ts, so load the same `ws` polyfill it does.
        test: {
          name: 'node',
          include: ['test/**/*.test.ts'],
          exclude: ['test/ui/**'],
          environment: 'node',
          setupFiles: ['src/polyfill.ts'],
          // Inlined so a test can load a second Trystero instance (its own selfId) to act as another peer.
          server: { deps: { inline: ['trystero', /@trystero-p2p/] } },
        },
      },
      {
        extends: true,
        test: {
          name: 'ui',
          // The page's server on a fixed port: the test bridges only accept known origins (test/ui/fixtures.ts).
          api: { port: PAGE_PORT, strictPort: true },
          include: ['test/ui/**/*.test.tsx'],
          globalSetup: ['test/ui/global-setup.ts'],
          browser: {
            enabled: true,
            headless: true,
            // The pairing code's copy button is checked by reading the real clipboard back.
            provider: playwright({ contextOptions: { permissions: ['clipboard-read', 'clipboard-write'] } }),
            instances: [{ browser: 'chromium' }],
            screenshotFailures: false,
            commands: {
              freshDown: () => fixtures().freshDown(),
              freshUp: () => fixtures().freshUp(),
            },
          },
        },
      },
    ],
    coverage: {
      provider: 'istanbul',
      include: ['src/**', 'ui/src/**'],
      // The process entry (argv, exit codes, signals) runs only as a real process: the smoke test starts the built CLI.
      exclude: ['src/cli.ts'],
      reporter: ['text-summary'],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});

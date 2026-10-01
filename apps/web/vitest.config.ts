import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import { bridgeAllowOrigin, bridgePairingCode, bridgeRevokeOrigin, setPermissions } from './test/browser/core/commands.ts';

// Two projects, one coverage report:
// - unit: pure modules in Node.
// - browser: components and app flows in real Chromium (real React, IndexedDB, WebSocket) against the local test
//   relay and file server started by globalSetup. No mocks.
export default defineConfig({
  plugins: [react({ include: /\.(jsx|tsx)$/ })],
  resolve: { dedupe: ['react', 'react-dom'] },
  test: {
    projects: [
      { extends: true, test: { name: 'unit', include: ['test/**/*.test.ts'], exclude: ['test/browser/**'], environment: 'node' } },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['test/browser/**/*.test.{ts,tsx}'],
          globalSetup: ['test/browser/global-setup.ts', 'test/browser/core/bridge-setup.ts'],
          // Test files share one page origin, so IndexedDB and the store are shared: run them one at a time.
          fileParallelism: false,
          browser: {
            enabled: true,
            headless: true,
            // Chromium's built-in fake camera/mic and auto-accepted permission prompt (browser features, not mocks).
            provider: playwright({
              launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--auto-accept-this-tab-capture'] },
              contextOptions: { permissions: ['microphone', 'camera'] },
            }),
            instances: [{ browser: 'chromium' }],
            screenshotFailures: false,
            commands: { setPermissions, bridgePairingCode, bridgeAllowOrigin, bridgeRevokeOrigin },
          },
        },
      },
    ],
    coverage: {
      provider: 'istanbul',
      // The UI kit is source too (JSX consumed directly), so it's held to the same bar.
      include: ['src/**', '**/packages/ui/components/**'],
      allowExternal: true,
      reporter: ['text-summary'],
      // Below 100% mostly because the huddle (call) UI is deliberately not browser/E2E-tested with camera, mic, video
      // or screen sharing (see AGENTS.md), plus a few Home/Settings branches. Floors sit at what's reached: only up.
      thresholds: { lines: 97.6, branches: 97.1, functions: 97.4, statements: 97.4 },
    },
  },
});

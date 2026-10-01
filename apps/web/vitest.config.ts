import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import { bridgeAllowOrigin, bridgePairingCode, bridgeRevokeOrigin, emulateTouch, emulateUserAgent, reduceMotion, setPermissions } from './test/browser/core/commands.ts';

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
              // WebShare: Chromium's share sheet, off in headless builds by default (the invite link's Share button).
              launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--auto-accept-this-tab-capture', '--enable-features=WebShare'] },
              contextOptions: { permissions: ['microphone', 'camera'] },
            }),
            instances: [{ browser: 'chromium' }],
            screenshotFailures: false,
            commands: { setPermissions, bridgePairingCode, bridgeAllowOrigin, bridgeRevokeOrigin, reduceMotion, emulateTouch, emulateUserAgent },
          },
        },
      },
    ],
    coverage: {
      provider: 'istanbul',
      // The UI kit is source too (JSX consumed directly), so it's held to the same bar.
      include: ['src/**', '**/packages/ui/components/**'],
      // Code that only runs with a built, registered service worker (no worker exists in dev or these tests): wiring
      // only, with its decisions in tested modules (lib/swLogic.ts); e2e/pwa.spec.ts runs it against the build.
      // ui/share.ts calls the system share sheet, which brings headless Chromium down on macOS: it's five lines, read by
      // hand, and its button is checked to appear (settings.test.tsx).
      exclude: ['src/sw.ts', 'src/lib/swClient.ts', 'src/ui/share.ts'],
      allowExternal: true,
      // Per-file table in CI logs, so coverage differences between machines can be traced.
      reporter: process.env.CI ? ['text'] : ['text-summary'],
      // Below 100% mostly because the huddle (call) UI is deliberately not browser/E2E-tested with camera, mic, video
      // or screen sharing (see AGENTS.md), plus a few Home/Settings branches. ~97.3–97.7% is reached; the floor keeps
      // a small margin because a few timing-dependent paths run on some machines and not others (CI vs local).
      thresholds: { lines: 97, branches: 97, functions: 97, statements: 97 },
    },
  },
});

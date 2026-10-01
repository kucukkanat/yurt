import { defineConfig, devices } from '@playwright/test';

// Tests the production build exactly as GitHub Pages serves it (same /yurt/ base path, minified, with its service
// worker and manifest), locally and in CI alike, so a local pass means a CI pass. The dev server has no worker.
const ci = !!process.env.CI;
const app = {
  command: 'bun run --filter @yurt/web build && bun run --filter @yurt/web preview --base /yurt/ --port 4173 --strictPort',
  url: 'http://localhost:4173/yurt/',
};

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 90_000 }, // peers find each other over public Nostr relays
  retries: 1,
  use: { baseURL: app.url, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /(mobile|pwa)\.spec/ },
    // The installable app: the full browser in its new headless mode, which (unlike the default headless shell)
    // lets a service worker show notifications.
    { name: 'pwa', use: { ...devices['Desktop Chrome'], channel: 'chromium' }, testMatch: /pwa\.spec/ },
    // A phone: touch input, a narrow screen and a coarse pointer (gestures, the action sheet).
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec/ },
  ],
  webServer: [
    // Never reuse the app's server: an old build would test old code.
    { ...app, reuseExistingServer: false, timeout: 180_000 },
    // Local Nostr relay so relay-workspace tests never depend on public relays.
    { command: 'bun run --filter @yurt/protocol relay', env: { PORT: '7777' }, port: 7777, reuseExistingServer: !ci },
    { command: 'bun run --filter @yurt/protocol blossom', env: { PORT: '7778' }, port: 7778, reuseExistingServer: !ci },
  ],
});

import { defineConfig, devices } from '@playwright/test';

// CI tests the production build exactly as GitHub Pages serves it (same /yurt/ base path, minified, no Vite
// on-demand dependency optimisation that can reload a page mid-test). Locally the dev server keeps it quick.
const ci = !!process.env.CI;
const app = ci
  ? {
      command: 'bun run --filter @yurt/web build && bun run --filter @yurt/web preview --base /yurt/ --port 4173 --strictPort',
      url: 'http://localhost:4173/yurt/',
    }
  : { command: 'bun run --filter @yurt/web dev --port 5173 --strictPort', url: 'http://localhost:5173/' };

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 90_000 }, // peers find each other over public Nostr relays
  retries: 1,
  use: { baseURL: app.url, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    // Never reuse a server in CI: a stale one would test old code.
    { ...app, reuseExistingServer: !ci, timeout: 180_000 },
    // Local Nostr relay so relay-workspace tests never depend on public relays.
    { command: 'bun run --filter @yurt/protocol relay', env: { PORT: '7777' }, port: 7777, reuseExistingServer: !ci },
    { command: 'bun run --filter @yurt/protocol blossom', env: { PORT: '7778' }, port: 7778, reuseExistingServer: !ci },
  ],
});

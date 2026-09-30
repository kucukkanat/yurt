import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 90_000 }, // peers find each other over public Nostr relays
  retries: 1,
  use: { baseURL: 'http://localhost:5173/', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: 'npm run dev -w apps/web -- --port 5173 --strictPort', url: 'http://localhost:5173/', reuseExistingServer: true, timeout: 120_000 },
    // Local Nostr relay so relay-workspace tests never depend on public relays.
    { command: 'npm run relay -w packages/protocol', env: { PORT: '7777' }, port: 7777, reuseExistingServer: true },
    { command: 'npm run blossom -w packages/protocol', env: { PORT: '7778' }, port: 7778, reuseExistingServer: true },
  ],
});

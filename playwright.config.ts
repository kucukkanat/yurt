import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 90_000 }, // peers find each other over public Nostr relays
  retries: 1,
  use: { baseURL: 'http://localhost:5173/', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'npm run dev -w apps/web -- --port 5173 --strictPort', url: 'http://localhost:5173/', reuseExistingServer: true, timeout: 120_000 },
});

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  // The specs assert the Azerbaijani UI; the browser's own language would pick English otherwise.
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure', locale: 'az-AZ' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @taskop/api start',
      url: 'http://localhost:3000/api/v1/health',
      reuseExistingServer: !process.env.CI,
      cwd: '../..',
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @taskop/web dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      cwd: '../..',
      timeout: 120_000,
    },
  ],
});

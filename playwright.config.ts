import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // Tests share a real socket.io server — must not run in parallel
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: 'line',

  use: {
    baseURL: 'http://localhost:4200',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      command: 'npm run dev:server',
      url: 'http://localhost:3000/health',
      reuseExistingServer: !process.env['CI'],
      timeout: 30_000,
    },
    {
      command: 'npm run dev:client',
      url: 'http://localhost:4200',
      reuseExistingServer: !process.env['CI'],
      timeout: 90_000,
    },
  ],
});

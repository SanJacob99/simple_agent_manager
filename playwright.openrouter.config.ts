import { defineConfig, devices } from '@playwright/test';

const FRONTEND_PORT = 4173;
const BACKEND_PORT = 3210;

export default defineConfig({
  testDir: './e2e',
  testMatch: /openrouter-chat\.spec\.ts/,
  fullyParallel: false,
  retries: 2,
  timeout: 180_000,
  expect: {
    timeout: 60_000,
  },
  use: {
    baseURL: `http://127.0.0.1:${FRONTEND_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: `npm run dev:server`,
      url: `http://127.0.0.1:${BACKEND_PORT}/api/health`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: `npm run dev:client -- --host 127.0.0.1 --port ${FRONTEND_PORT}`,
      url: `http://127.0.0.1:${FRONTEND_PORT}`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
  reporter: 'line',
});

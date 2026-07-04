import { defineConfig } from '@playwright/test';

const baseURL = process.env.BASE_URL || 'http://localhost:3004';
const slowMo = process.env.SLOW_MO ? parseInt(process.env.SLOW_MO, 10) : 0;

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  timeout: 120000, // 2 minutes for cloud operations
  fullyParallel: false, // Run tests serially for cookie jar management
  workers: 1,
  expect: {
    timeout: 30000,
  },
  use: {
    baseURL,
    trace: 'on-first-retry',
    launchOptions: {
      slowMo,
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});

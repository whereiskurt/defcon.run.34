import { defineConfig } from '@playwright/test';

const baseURL = process.env.BASE_URL || 'https://gpx.defcon.run';

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
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  timeout: 120000, // 2 minutes for ALTCHA solving + email wait
  // Run tests serially to ensure cookie jar is properly managed
  fullyParallel: false,
  workers: 1,
  expect: {
    timeout: 30000,
  },
  use: {
    baseURL: 'https://auth.defcon.run',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});

import { defineConfig } from '@playwright/test';

const baseURL = process.env.BASE_URL || 'http://localhost:3002';

export default defineConfig({
  testDir: '.',
  testMatch: ['setup/**/*.spec.ts', 'tests/**/*.spec.ts'],
  timeout: 180000, // 3 minutes for ALTCHA + email wait (up to 2 min)
  // Run tests serially to ensure cookie jar is properly managed
  fullyParallel: false,
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
  // Reporter configuration
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],
});

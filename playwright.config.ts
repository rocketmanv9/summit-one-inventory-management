import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Summit Inventory Management
 *
 * Test organization:
 * - tests/ - Unit and integration tests (DB, RPC, event compliance)
 * - e2e/ - End-to-end user journey tests (coming soon)
 * - __tests__/ - Component and security tests
 */

export default defineConfig({
  testDir: './',
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/tests/**/*.test.ts',
    '**/e2e/**/*.spec.ts'
  ],

  // Maximum time one test can run
  timeout: 30 * 1000,

  // Run tests in files in parallel
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Opt out of parallel tests on CI
  workers: process.env.CI ? 1 : undefined,

  // Reporter to use
  reporter: process.env.CI
    ? [['github'], ['html']]
    : [['list'], ['html']],

  use: {
    // Base URL for navigation
    baseURL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',

    // Collect trace when retrying the failed test
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',
  },

  // Configure projects for different test types
  projects: [
    {
      name: 'unit-tests',
      testMatch: ['**/tests/**/*.test.ts', '**/__tests__/**/*.test.ts'],
      // Unit tests don't need browsers
      use: {},
    },

    {
      name: 'e2e-chromium',
      testMatch: '**/e2e/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },

    {
      name: 'e2e-firefox',
      testMatch: '**/e2e/**/*.spec.ts',
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'e2e-webkit',
      testMatch: '**/e2e/**/*.spec.ts',
      use: { ...devices['Desktop Safari'] },
    },
  ],

  // Run dev server before starting tests (optional)
  // webServer: {
  //   command: 'npm run dev',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});

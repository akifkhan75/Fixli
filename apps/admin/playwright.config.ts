import { defineConfig } from '@playwright/test';

// Browser test of the staff portal (doc 27 F8.1). Needs the API running with ADMIN_TOTP_REQUIRED=false and
// the test accounts seeded:  pnpm --filter @fixli/api db:seed:catalog && pnpm --filter @fixli/api seed:e2e
// Run:  API_URL=http://localhost:3002/api pnpm --filter admin e2e
const API_URL = process.env.API_URL ?? 'http://localhost:3002/api';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // one shared database, steps depend on each other
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://localhost:5174', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: {
    command: 'pnpm exec vite --port 5174 --strictPort',
    url: 'http://localhost:5174',
    reuseExistingServer: !process.env.CI,
    env: { VITE_API_URL: API_URL },
    timeout: 60_000,
  },
});

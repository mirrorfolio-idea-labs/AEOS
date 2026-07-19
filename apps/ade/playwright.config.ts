import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:7777' },
  webServer: {
    command: 'node test/harness.mjs',
    url: 'http://127.0.0.1:7777/v1/health',
    reuseExistingServer: false,
    stdout: 'pipe',
    env: { AEOS_HOME: `${import.meta.dirname}/.playwright-home` },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});

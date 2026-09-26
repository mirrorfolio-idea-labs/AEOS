import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:7777' },
  webServer: [
    {
      command: 'node test/harness.mjs',
      url: 'http://127.0.0.1:7777/v1/health',
      reuseExistingServer: false,
      stdout: 'pipe',
      env: { AEOS_HOME: `${import.meta.dirname}/.playwright-home` },
    },
    {
      // P4.M3.T3: a token-protected daemon (remote posture)
      command: 'node test/harness.mjs',
      url: 'http://127.0.0.1:7778/healthz',
      reuseExistingServer: false,
      stdout: 'pipe',
      env: { AEOS_HOME: `${import.meta.dirname}/.playwright-home-token`, PORT: '7778', AEOS_API_TOKEN: 'playwright-remote-token-0123456789' },
    },
  ],
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});

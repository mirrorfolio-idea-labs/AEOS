import { defineWorkspace } from 'vitest/config';

// apps/ade is excluded: its suite is Playwright (pnpm -F @aeos/ade test), not vitest.
export default defineWorkspace(['packages/*', 'apps/aeosd', 'apps/cli']);

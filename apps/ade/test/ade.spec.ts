import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { agentDir } from '@aeos/kernel';
import { initMemoryLayout, writeMemoryFile } from '@aeos/memory';

const HOME = path.join(import.meta.dirname, '..', '.playwright-home');

test.describe.configure({ mode: 'serial' });

test('T1: create workspace and agent through the sidebar', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('workspace-name').fill('Client Acme');
  await page.getByTestId('create-workspace').click();
  await expect(page.getByText('Client Acme').first()).toBeVisible();

  await page.getByTestId('agent-name').fill('Backend Dev');
  await page.getByTestId('create-agent').click();
  await expect(page.getByTestId('agent-backend-dev')).toBeVisible();
});

test('T2: running an objective streams provider-fake output into the console', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('agent-backend-dev').click();
  await page.getByTestId('objective-id').fill('obj-ui');
  await page.getByTestId('objective-title').fill('UI objective');
  await page.getByTestId('objective-tasks').fill('T1: stream some output');
  await page.getByTestId('run-objective').click();

  const console_ = page.getByTestId('console');
  await expect(console_).toContainText('session.created', { timeout: 15_000 });
  await expect(console_).toContainText('Working on the objective.');
  await expect(console_).toContainText('session.completed');
  await expect(page.getByTestId('task-status-T1')).toHaveText('completed', { timeout: 15_000 });
});

test('T3: agent files browser opens a memory file and shows plan status', async ({ page }) => {
  const memoryRoot = path.join(agentDir(HOME, 'client-acme', 'backend-dev'), 'memory');
  await initMemoryLayout(memoryRoot);
  await writeMemoryFile(memoryRoot, 'identity/core.md', 'I am the Acme backend agent.\n', {
    title: 'Core identity',
    hook: 'who this agent is',
  });

  await page.goto('/');
  await page.getByTestId('agent-backend-dev').click();
  // reload plan state for the objective run in T2
  await page.getByTestId('objective-id').fill('obj-ui');
  await page.getByTestId('tab-files').click();
  await page.getByTestId('memory-identity/core.md').click();
  await expect(page.getByTestId('memory-file-view')).toContainText('Acme backend agent');
  await expect(page.getByTestId('files-plan-table')).toContainText('T1');
  await expect(page.getByTestId('files-plan-table')).toContainText('completed');
});

test('T4: BYOK switch is visible in UI state and cost.usage rows land in costs.ndjson', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('agent-backend-dev').click();
  await expect(page.getByTestId('credential-profile')).toHaveText('cp-default');
  await page.getByTestId('switch-credential').click();
  await page.getByTestId('credential-input').fill('cp-client-acme');
  await page.getByTestId('credential-apply').click();
  await expect(page.getByTestId('credential-profile')).toHaveText('cp-client-acme');

  // run another objective under the new profile and watch the meter move
  await page.getByTestId('objective-id').fill('obj-costs');
  await page.getByTestId('objective-tasks').fill('T1: spend a little');
  await page.getByTestId('run-objective').click();
  await expect(page.getByTestId('task-status-T1')).toHaveText('completed', { timeout: 15_000 });
  await expect(page.getByTestId('cost-meter')).not.toHaveText('$0.0000');

  const costs = await readFile(
    path.join(agentDir(HOME, 'client-acme', 'backend-dev'), 'objectives', 'obj-costs', 'costs.ndjson'),
    'utf8',
  );
  const rows = costs
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { type: string; payload: { usd: number } });
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((row) => row.type === 'cost.usage')).toBe(true);
  expect(rows[0]?.payload.usd).toBeGreaterThan(0);
});

import { describe, expect, it } from 'vitest';
import { classifyToolCall } from '../src/index.js';

describe('classifyToolCall', () => {
  it('maps read-only tools to read_files', () => {
    for (const tool of ['Read', 'Grep', 'Glob', 'LS', 'read', 'grep']) {
      expect(classifyToolCall(tool, {})).toBe('read_files');
    }
  });

  it('maps file-mutating tools to write_files', () => {
    for (const tool of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) {
      expect(classifyToolCall(tool, {})).toBe('write_files');
    }
  });

  it('sub-classifies bash commands by their first word', () => {
    const bash = (command: string): string =>
      classifyToolCall('Bash', { command });
    expect(bash('pnpm test')).toBe('execute_commands');
    expect(bash('git commit -m "x"')).toBe('git_commit');
    expect(bash('git push origin main')).toBe('git_push');
    expect(bash('npm install left-pad')).toBe('install_packages');
    expect(bash('pnpm add zod')).toBe('install_packages');
    expect(bash('pip install requests')).toBe('install_packages');
    expect(bash('curl https://example.com')).toBe('network_access');
    expect(bash('wget -O out https://example.com')).toBe('network_access');
    expect(bash('./scripts/deploy.sh')).toBe('execute_commands');
  });

  it('classifies web tools as network access', () => {
    expect(classifyToolCall('WebFetch', { url: 'https://example.com' })).toBe('network_access');
    expect(classifyToolCall('WebSearch', { query: 'x' })).toBe('network_access');
  });

  it('fails closed: unknown tools land on execute_commands', () => {
    expect(classifyToolCall('MysteryTool', {})).toBe('execute_commands');
    expect(classifyToolCall('', null)).toBe('execute_commands');
  });

  it('does not sub-classify past word boundaries or chained commands beyond the first segment', () => {
    const bash = (command: string): string =>
      classifyToolCall('Bash', { command });
    // 'github' must not match 'git push'/'git commit' prefixes
    expect(bash('gh pr create')).toBe('execute_commands');
    // only the FIRST command is inspected — documented limitation, daemon
    // enforcement re-checks each subsequent call anyway
    expect(bash('echo ok && git push')).toBe('execute_commands');
  });
});

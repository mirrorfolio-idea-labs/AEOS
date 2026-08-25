import type { PermissionTier } from '@aeos/contracts';

/**
 * Map a harness tool call to its permission tier (spec §11). Conservative by
 * construction: unknown tools classify as `execute_commands` so an unmapped
 * capability can never sneak under a read-only posture.
 *
 * Bash commands are inspected on their FIRST segment only (`echo x && git
 * push` classifies from `echo`). This is deliberate: the compiler uses the
 * tier for harness-native flags, while daemon-side enforcement (T3) re-checks
 * every call independently — defense in depth does not rely on this table.
 */

const READ_TOOLS = new Set(['read', 'grep', 'glob', 'ls']);
const WRITE_TOOLS = new Set(['edit', 'write', 'multiedit', 'notebookedit']);
const WEB_TOOLS = new Set(['webfetch', 'websearch']);

const INSTALL_WORDS = /^(npm|pnpm|yarn|bun|pip|pip3|cargo|gem|composer|apt|brew)\s+(install|add|i)(\s|$)/;

function firstWord(command: string): string {
  return command.trim().split(/\s+/)[0] ?? '';
}

export function classifyToolCall(tool: string, input: unknown): PermissionTier {
  const name = tool.trim().toLowerCase();
  if (READ_TOOLS.has(name)) return 'read_files';
  if (WRITE_TOOLS.has(name)) return 'write_files';
  if (WEB_TOOLS.has(name)) return 'network_access';
  if (name === 'bash') {
    const command =
      typeof input === 'object' && input !== null && 'command' in input
        ? String((input as { command: unknown }).command)
        : '';
    return classifyCommand(command);
  }
  return 'execute_commands';
}

export function classifyCommand(command: string): PermissionTier {
  const word = firstWord(command);
  if (/^git$/.test(word)) {
    if (/^git\s+push(\s|$)/.test(command.trim())) return 'git_push';
    if (/^git\s+commit(\s|$)/.test(command.trim())) return 'git_commit';
    return 'execute_commands';
  }
  if (INSTALL_WORDS.test(command.trim())) return 'install_packages';
  if (/^(curl|wget|ssh|scp|nc|netcat)$/.test(word)) return 'network_access';
  return 'execute_commands';
}

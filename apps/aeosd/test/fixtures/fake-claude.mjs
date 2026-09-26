#!/usr/bin/env node
// Stand-in `claude` binary for the P4.M1 container e2e (BYO binaryPath).
// Speaks just enough stream-json for the Claude adapter, and records WHERE
// it ran plus whether a host canary outside the worktree was reachable —
// the escape-canary proof. Test-only; never shipped.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
if (args.includes('--version')) {
  console.log('2.1.0 (Claude Code)');
  process.exit(0);
}
const prompt = args[args.indexOf('-p') + 1] ?? '';
const proofName = /PROOF=([a-z0-9-]+)/.exec(prompt)?.[1] ?? 'proof';
const canary = /CANARY=(\S+)/.exec(prompt)?.[1];

const attempt = (fn) => {
  try {
    return { ok: true, value: fn() };
  } catch (error) {
    return { ok: false, code: error.code ?? String(error) };
  }
};
const proof = {
  cwd: process.cwd(),
  inContainer: fs.existsSync('/.dockerenv'),
  uid: process.getuid?.(),
  home: process.env.HOME,
  configDirVisible: process.env.CLAUDE_CONFIG_DIR !== undefined && fs.existsSync(process.env.CLAUDE_CONFIG_DIR),
  canaryRead: canary === undefined ? undefined : attempt(() => fs.readFileSync(canary, 'utf8')),
  canaryWrite: canary === undefined || !prompt.includes('TRY_WRITE') ? undefined : attempt(() => fs.writeFileSync(canary, 'pwned\n')),
  hostRootListing: attempt(() => fs.readdirSync(path.dirname(path.dirname(process.cwd()))).length),
};
fs.writeFileSync(path.join(process.cwd(), `${proofName}.json`), JSON.stringify(proof, null, 2) + '\n');

const sid = `fake-${proofName}`;
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
out({ type: 'system', subtype: 'init', cwd: process.cwd(), session_id: sid, tools: [], model: 'fake', permissionMode: 'default', apiKeySource: 'ANTHROPIC_API_KEY' });
out({ type: 'assistant', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'fake', content: [{ type: 'text', text: `wrote ${proofName}.json` }] }, session_id: sid });
out({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1, duration_api_ms: 1, num_turns: 1, result: 'done', session_id: sid, total_cost_usd: 0.001, usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } });

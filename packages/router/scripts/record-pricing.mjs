// Re-record the OpenRouter fixture from a machine with network access:
//   pnpm -F @aeos/router record:pricing
// Keeps a representative slice (Anthropic + a few others) so the fixture stays small.
import { writeFileSync } from 'node:fs';
const res = await fetch('https://openrouter.ai/api/v1/models');
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const body = await res.json();
const keep = body.data.filter((m) => /^(anthropic|openai|google)\//.test(m.id)).slice(0, 40);
writeFileSync(new URL('../test/fixtures/openrouter-models.json', import.meta.url), JSON.stringify({ data: keep }, null, 2) + '\n');
console.log(`recorded ${keep.length} models`);

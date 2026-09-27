/**
 * docs/reference/api.md, rendered from the committed OpenAPI document
 * (P5.M6.T5). openapi.json is itself drift-tested against the live routes,
 * so the page follows the code: `pnpm -F @aeos/api gen:reference` writes it
 * and test/reference-drift.test.ts fails when they differ.
 */
interface Operation {
  tags?: string[];
  summary?: string;
  description?: string;
  parameters?: Array<{ name: string; in: string; required?: boolean }>;
}
export interface OpenApiDocument {
  info?: { title?: string; description?: string };
  paths: Record<string, Record<string, Operation>>;
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim();

export function renderApiReference(spec: OpenApiDocument): string {
  const groups = new Map<string, string[]>();
  for (const [route, operations] of Object.entries(spec.paths)) {
    for (const method of METHODS) {
      const op = operations[method];
      if (op === undefined) continue;
      const tag = op.tags?.[0] ?? 'general';
      const params = (op.parameters ?? [])
        .filter((p) => p.in === 'query')
        .map((p) => `\`${p.name}\`${p.required === true ? '' : '?'}`)
        .join(', ');
      const rows = groups.get(tag) ?? [];
      rows.push(`| \`${method.toUpperCase()}\` | \`${route}\` | ${params || '—'} | ${cell(op.description ?? op.summary ?? '')} |`);
      groups.set(tag, rows);
    }
  }

  const out = [
    '# API reference',
    '',
    '<!-- Generated from packages/api/openapi.json by `pnpm -F @aeos/api gen:reference`.',
    '     Do not edit by hand: CI fails when this page and the API disagree. -->',
    '',
    `${cell(spec.info?.description ?? '')} The daemon serves it at`,
    '`http://127.0.0.1:7777` by default. When a token is set, every `/v1` request',
    'needs `Authorization: Bearer <token>`. The full machine-readable spec is',
    '[`packages/api/openapi.json`](../../packages/api/openapi.json).',
    '',
    `Sections: ${[...groups.keys()].map((t) => `[${t}](#${t})`).join(' · ')}`,
  ];
  for (const [tag, rows] of groups) {
    out.push('', `## ${tag}`, '', '| Method | Path | Query | Description |', '|---|---|---|---|', ...rows);
  }
  return out.join('\n') + '\n';
}

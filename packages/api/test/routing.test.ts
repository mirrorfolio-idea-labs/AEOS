import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { AeosEventSchema, CredentialProfileSchema, newEventId, type AeosEvent } from '@aeos/contracts';
import { attachAuditWriter, createEventBus } from '@aeos/kernel';
import { FakeAdapter, buildFixtureEvents, type HarnessAdapter, type SpawnOptions } from '@aeos/provider-core';
import { createApiServer } from '../src/index.js';

let home: string;
let app: FastifyInstance;
const spawns: Array<{ provider: string; model: string | undefined; task: string }> = [];
const events: AeosEvent[] = [];

/** Fake per provider; codex-like fakes report tokens only (costUsd: false). */
function fakeFor(provider: string): HarnessAdapter {
  const fixture = buildFixtureEvents({ profileId: 'cp' });
  const tokensOnly = provider === 'codex';
  const inner = new FakeAdapter({
    providerSessionId: `ses_${provider}`,
    events: tokensOnly
      ? fixture.map((e) =>
          e.type === 'cost.usage'
            ? AeosEventSchema.parse({ ...e, id: newEventId(), payload: { ...e.payload, usd: 0, inputTokens: 1_000_000, outputTokens: 100_000 } })
            : e,
        )
      : fixture,
  });
  return {
    id: provider,
    capabilities: () => ({ ...inner.capabilities(), costUsd: !tokensOnly }),
    createProfile: (agent) => inner.createProfile(agent),
    translate: (raw) => inner.translate(raw),
    spawn(opts: SpawnOptions) {
      spawns.push({ provider, model: opts.model, task: opts.objective.split('\n')[0] ?? '' });
      return inner.spawn(opts);
    },
  };
}

beforeEach(async () => {
  spawns.length = 0;
  events.length = 0;
  home = await mkdtemp(path.join(os.tmpdir(), 'aeos-routing-'));
  const bus = createEventBus();
  bus.subscribe({}, (e) => events.push(e));
  attachAuditWriter(bus, home);
  app = await createApiServer({
    home,
    adapterFor: (agent, opts) => fakeFor(opts?.provider ?? agent.harness.provider),
    credentialFor: () => CredentialProfileSchema.parse({ id: 'cp', kind: 'api-key', secretRef: 'x' }),
    bus,
    notify: false,
  });
  await app.inject({ method: 'POST', url: '/v1/workspaces', payload: { id: 'ws', name: 'W' } });
  await app.inject({
    method: 'POST',
    url: '/v1/agents',
    payload: { id: 'dev', workspaceId: 'ws', name: 'Dev', harness: { provider: 'claude-code', featureToggles: {} }, credentialProfileId: 'cp' },
  });
});
afterEach(async () => {
  await app.close();
  await rm(home, { recursive: true, force: true });
});

describe('P3.M2 exit gate — classes route to different providers per policy', () => {
  it('architect/implement/docs hit claude-code/codex/opencode with the documented models; records + audit carry the decision', async () => {
    await mkdir(path.join(home, 'workspaces', 'ws'), { recursive: true });
    await writeFile(
      path.join(home, 'workspaces', 'ws', 'routing.yaml'),
      'classes:\n  implement: { provider: codex, model: gpt-5-codex }\n  docs: { provider: opencode }\n',
    );
    await app.inject({
      method: 'POST',
      url: '/v1/objectives',
      payload: { workspaceId: 'ws', agentId: 'dev', id: 'obj', title: 'Routed', tasks: [{ id: 'T1', title: 'placeholder' }] },
    });
    const planPath = path.join(home, 'workspaces', 'ws', 'agents', 'dev', 'objectives', 'obj', 'plan.md');
    await writeFile(
      planPath,
      '# Routed\n\n- [ ] **T1** [architect] Design it\n- [ ] **T2** Build it\n- [ ] **T3** [docs] Document it\n',
    );
    await app.inject({ method: 'POST', url: '/v1/objectives/obj/start?workspaceId=ws&agentId=dev' });
    for (let i = 0; i < 300; i++) {
      const s = (await app.inject({ url: '/v1/objectives/obj?workspaceId=ws&agentId=dev' })).json().data;
      if (!s.running && s.tasks.every((t: { status: string }) => t.status === 'completed')) break;
      await delay(20);
    }

    expect(spawns).toEqual([
      { provider: 'claude-code', model: 'claude-opus-5', task: 'Design it' },
      { provider: 'codex', model: 'gpt-5-codex', task: 'Build it' },
      { provider: 'opencode', model: undefined, task: 'Document it' },
    ]);

    const routes = (await app.inject({ url: '/v1/objectives/obj/routes?workspaceId=ws&agentId=dev' })).json().data;
    expect(routes.map((r: { taskId: string; decision: { provider: string } }) => `${r.taskId}:${r.decision.provider}`)).toEqual([
      'T1:claude-code',
      'T2:codex',
      'T3:opencode',
    ]);
    // tokens-only harness gets a token-priced USD from the (static/cached) index — here unknown model → absent;
    // the claude-code task reports real USD
    expect(routes[0].realized).toMatchObject({ status: 'completed', usd: 0.0042 });
    expect(routes[1].realized.tokens).toEqual({ input: 1_000_000, output: 100_000 });

    const decided = events.filter((e) => e.type === 'route.decided');
    expect(decided.map((e) => e.taskId)).toEqual(['T1', 'T2', 'T3']);
    const auditFile = (await readdir(path.join(home, 'audit')))[0]!;
    const audit = await readFile(path.join(home, 'audit', auditFile), 'utf8');
    expect(audit).toContain('"type":"route.decided"');
    expect(audit).toContain('"providerSource":"workspace"');
  });

  it('derives USD for a tokens-only provider when the model is priced', async () => {
    await mkdir(path.join(home, 'workspaces', 'ws'), { recursive: true });
    await writeFile(path.join(home, 'workspaces', 'ws', 'routing.yaml'), 'classes:\n  implement: { provider: codex, model: claude-sonnet-5 }\n');
    await app.inject({
      method: 'POST',
      url: '/v1/objectives',
      payload: { workspaceId: 'ws', agentId: 'dev', id: 'o2', title: 'x', tasks: [{ id: 'T1', title: 'Build' }] },
    });
    await app.inject({ method: 'POST', url: '/v1/objectives/o2/start?workspaceId=ws&agentId=dev' });
    let routes: Array<{ realized: { derivedUsd?: number } }> = [];
    for (let i = 0; i < 300 && routes.length === 0; i++) {
      routes = (await app.inject({ url: '/v1/objectives/o2/routes?workspaceId=ws&agentId=dev' })).json().data;
      await delay(20);
    }
    // static table: sonnet-5 = $2 in / $10 out per MTok → 1M in + 100k out = $3.00
    expect(routes[0]?.realized.derivedUsd).toBeCloseTo(3, 6);
  });
});

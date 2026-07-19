import { describe, expect, it } from 'vitest';
import {
  AgentConfigSchema,
  assertSessionTransition,
  CheckpointSchema,
  CredentialProfileSchema,
  InvalidTransitionError,
  ObjectiveSchema,
  PlanTaskSchema,
  SessionRecordSchema,
  WorkspaceSchema,
} from '../src/index.js';

describe('domain schemas', () => {
  it('parses a workspace', () => {
    expect(WorkspaceSchema.parse({ id: 'mirrorfolio', name: 'Mirrorfolio' }).id).toBe('mirrorfolio');
  });

  it('parses all three credential profile kinds and rejects inline secrets', () => {
    expect(CredentialProfileSchema.parse({ id: 'sub', kind: 'subscription' }).kind).toBe('subscription');
    // pre-slot profiles default; named slots pin one concrete account
    const defaulted = CredentialProfileSchema.parse({ id: 'sub', kind: 'subscription' });
    expect(defaulted.kind === 'subscription' && defaulted.slot).toBe('default');
    const acme = CredentialProfileSchema.parse({ id: 'sub-acme', kind: 'subscription', slot: 'client-acme' });
    expect(acme.kind === 'subscription' && acme.slot).toBe('client-acme');
    expect(
      CredentialProfileSchema.parse({ id: 'byok', kind: 'api-key', secretRef: 'anthropic/main' }).kind,
    ).toBe('api-key');
    const gw = CredentialProfileSchema.parse({
      id: 'or',
      kind: 'gateway',
      baseUrl: 'https://openrouter.ai/api/v1',
      secretRef: 'openrouter/main',
      model: 'anthropic/claude-sonnet-5',
    });
    expect(gw.kind).toBe('gateway');
    // secrets are ALWAYS refs into the secret store — never literal values
    expect(() =>
      CredentialProfileSchema.parse({ id: 'bad', kind: 'api-key', apiKey: 'sk-ant-xxx' }),
    ).toThrow();
    // stray-key rejection in isolation: secretRef present and valid, so the
    // ONLY reason to fail is the extra key — proves .strict() carries the invariant
    expect(() =>
      CredentialProfileSchema.parse({
        id: 'bad2', kind: 'api-key', secretRef: 'anthropic/main', apiKey: 'sk-ant-xxx',
      }),
    ).toThrow();
  });

  it('rejects empty strings on min(1) fields', () => {
    expect(() => WorkspaceSchema.parse({ id: '', name: 'Mirrorfolio' })).toThrow();
    expect(() => CredentialProfileSchema.parse({ id: 'byok', kind: 'api-key', secretRef: '' })).toThrow();
    expect(() => PlanTaskSchema.parse({ id: '', title: 'Write schema', status: 'pending' })).toThrow();
  });

  it('parses an agent.yaml shape with hermetic defaults', () => {
    const agent = AgentConfigSchema.parse({
      id: 'ada',
      workspaceId: 'mirrorfolio',
      name: 'Ada',
      harness: { provider: 'claude-code' },
      credentialProfileId: 'byok',
    });
    // hermetic-by-default (spec D2): every toggle defaults to false
    expect(agent.harness.featureToggles).toEqual({
      plugins: false, skills: false, mcpServers: false, userClaudeMd: false, autoMemory: false,
    });
  });

  it('enforces the session state machine', () => {
    expect(() => assertSessionTransition('created', 'starting')).not.toThrow();
    expect(() => assertSessionTransition('running', 'waiting_approval')).not.toThrow();
    expect(() => assertSessionTransition('completed', 'running')).toThrow(InvalidTransitionError);
    expect(() => assertSessionTransition('created', 'completed')).toThrow(InvalidTransitionError);
  });

  it('parses session record, objective, plan task, and checkpoint fixtures', () => {
    expect(
      SessionRecordSchema.parse({
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        agentId: 'ada',
        state: 'running',
        providerSessionId: 'claude-abc',
        runnerPid: 4242,
      }).state,
    ).toBe('running');
    expect(ObjectiveSchema.parse({ id: 'obj-1', agentId: 'ada', title: 'Ship login', budgetUsd: 20 }).budgetUsd).toBe(20);
    expect(PlanTaskSchema.parse({ id: 'T1', title: 'Write schema', status: 'pending' }).status).toBe('pending');
    const cp = CheckpointSchema.parse({
      taskId: 'T1', status: 'completed', summary: 'Schema written and tested', costs: { usd: 0.42, tokens: 12345 },
    });
    expect(cp.costs.usd).toBeCloseTo(0.42);
  });
});

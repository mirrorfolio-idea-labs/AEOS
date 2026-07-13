import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentConfig, SessionRecord } from '@aeos/contracts';
import { newEventId } from '@aeos/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agentYaml, ensureAgentLayout, sessionDir, sessionYaml } from '../src/home/paths.js';
import {
  CodecError,
  readAgentYaml,
  readSessionYaml,
  writeAgentYaml,
  writeSessionYaml,
} from '../src/home/codecs.js';

function fixtureAgentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'agent-1',
    workspaceId: 'ws-1',
    name: 'Agent One',
    harness: {
      provider: 'claude-code',
      featureToggles: {
        plugins: false,
        skills: true,
        mcpServers: false,
        userClaudeMd: false,
        autoMemory: false,
      },
    },
    credentialProfileId: 'cred-1',
    ...overrides,
  };
}

function fixtureSessionRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: newEventId(),
    agentId: 'agent-1',
    state: 'created',
    ...overrides,
  };
}

describe('agent.yaml codec', () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'aeos-codecs-'));
    ensureAgentLayout(home, 'ws-1', 'agent-1');
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('writes then reads back an identical AgentConfig', () => {
    const config = fixtureAgentConfig();
    writeAgentYaml(home, 'ws-1', 'agent-1', config);

    expect(fs.existsSync(agentYaml(home, 'ws-1', 'agent-1'))).toBe(true);
    expect(readAgentYaml(home, 'ws-1', 'agent-1')).toEqual(config);
  });

  it('persists human-editable YAML, not JSON', () => {
    writeAgentYaml(home, 'ws-1', 'agent-1', fixtureAgentConfig());
    const raw = fs.readFileSync(agentYaml(home, 'ws-1', 'agent-1'), 'utf8');
    expect(raw).toContain('id: agent-1');
    expect(raw.trim().startsWith('{')).toBe(false);
  });

  it('refuses to write an invalid AgentConfig (validate-before-write)', () => {
    const invalid = fixtureAgentConfig({ id: 'NOT-A-VALID-SLUG!!' });
    const target = agentYaml(home, 'ws-1', 'agent-1');

    expect(() => writeAgentYaml(home, 'ws-1', 'agent-1', invalid)).toThrow(CodecError);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('never clobbers a previously-valid file when a later write is invalid', () => {
    const good = fixtureAgentConfig();
    writeAgentYaml(home, 'ws-1', 'agent-1', good);

    const invalid = fixtureAgentConfig({ credentialProfileId: '' });
    expect(() => writeAgentYaml(home, 'ws-1', 'agent-1', invalid)).toThrow(CodecError);

    expect(readAgentYaml(home, 'ws-1', 'agent-1')).toEqual(good);
  });

  it('rejects a hand-edited/corrupt file loudly with a CodecError naming the path', () => {
    const target = agentYaml(home, 'ws-1', 'agent-1');
    fs.writeFileSync(target, 'id: [this is not, valid: yaml structure for AgentConfig\n');

    let caught: unknown;
    try {
      readAgentYaml(home, 'ws-1', 'agent-1');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CodecError);
    expect((caught as CodecError).path).toBe(target);
  });

  it('rejects a syntactically-valid YAML file that fails schema validation', () => {
    const target = agentYaml(home, 'ws-1', 'agent-1');
    fs.writeFileSync(target, 'id: agent-1\nname: Missing required fields\n');

    expect(() => readAgentYaml(home, 'ws-1', 'agent-1')).toThrow(CodecError);
    try {
      readAgentYaml(home, 'ws-1', 'agent-1');
    } catch (err) {
      expect((err as CodecError).path).toBe(target);
      expect((err as CodecError).cause).toBeDefined();
    }
  });

  it('ignores *.tmp.* siblings when reading (readers must not see partial writes)', () => {
    writeAgentYaml(home, 'ws-1', 'agent-1', fixtureAgentConfig());
    const dir = path.dirname(agentYaml(home, 'ws-1', 'agent-1'));
    fs.writeFileSync(path.join(dir, 'agent.yaml.tmp.deadbeef'), 'garbage: not read');

    expect(readAgentYaml(home, 'ws-1', 'agent-1')).toEqual(fixtureAgentConfig());
  });
});

describe('session.yaml codec', () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'aeos-codecs-session-'));
    fs.mkdirSync(sessionDir(home, 'ws-1', 'agent-1', newEventId()).replace(/[^/]+$/, ''), {
      recursive: true,
    });
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('writes then reads back an identical SessionRecord', () => {
    const sessionId = newEventId();
    fs.mkdirSync(sessionDir(home, 'ws-1', 'agent-1', sessionId), { recursive: true });
    const record = fixtureSessionRecord({ id: sessionId });

    writeSessionYaml(home, 'ws-1', 'agent-1', sessionId, record);

    expect(readSessionYaml(home, 'ws-1', 'agent-1', sessionId)).toEqual(record);
  });

  it('round-trips optional runtime metadata (pid, socket, objectiveId)', () => {
    const sessionId = newEventId();
    fs.mkdirSync(sessionDir(home, 'ws-1', 'agent-1', sessionId), { recursive: true });
    const record = fixtureSessionRecord({
      id: sessionId,
      state: 'running',
      objectiveId: 'obj-1',
      runnerPid: 4242,
      runnerSocket: '/tmp/aeos-4242.sock',
    });

    writeSessionYaml(home, 'ws-1', 'agent-1', sessionId, record);
    expect(readSessionYaml(home, 'ws-1', 'agent-1', sessionId)).toEqual(record);
  });

  it('refuses to write a SessionRecord with an invalid id (not a ULID)', () => {
    const sessionId = newEventId();
    fs.mkdirSync(sessionDir(home, 'ws-1', 'agent-1', sessionId), { recursive: true });
    const invalid = fixtureSessionRecord({ id: 'not-a-ulid' });

    expect(() => writeSessionYaml(home, 'ws-1', 'agent-1', sessionId, invalid)).toThrow(
      CodecError,
    );
    expect(fs.existsSync(sessionYaml(home, 'ws-1', 'agent-1', sessionId))).toBe(false);
  });
});

describe('round-trip property: parse(stringify(x)) deep-equals x', () => {
  it('holds for a spread of AgentConfig fixtures', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aeos-codecs-prop-agent-'));
    try {
      const variants: AgentConfig[] = [
        fixtureAgentConfig(),
        fixtureAgentConfig({ profile: 'default', avatar: 'https://example.com/a.png' }),
        fixtureAgentConfig({
          harness: {
            provider: 'codex',
            version: '1.2.3',
            featureToggles: {
              plugins: true,
              skills: true,
              mcpServers: true,
              userClaudeMd: true,
              autoMemory: true,
            },
          },
        }),
        fixtureAgentConfig({
          modelPreferences: { planning: 'opus', coding: 'sonnet', quick: 'haiku' },
        }),
        fixtureAgentConfig({ id: 'z9', workspaceId: 'w', name: 'x'.repeat(200) }),
      ];

      for (const [i, config] of variants.entries()) {
        ensureAgentLayout(home, 'ws-1', `agent-${i}`);
        writeAgentYaml(home, 'ws-1', `agent-${i}`, config);
        expect(readAgentYaml(home, 'ws-1', `agent-${i}`)).toEqual(config);
      }
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('holds for a spread of SessionRecord fixtures', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aeos-codecs-prop-session-'));
    try {
      const states: SessionRecord['state'][] = [
        'created',
        'starting',
        'running',
        'waiting_approval',
        'paused',
        'completed',
        'failed',
        'orphaned',
      ];

      for (const [i, state] of states.entries()) {
        const sessionId = newEventId();
        const record = fixtureSessionRecord({
          id: sessionId,
          state,
          objectiveId: i % 2 === 0 ? `obj-${i}` : undefined,
          runnerPid: i % 3 === 0 ? 1000 + i : undefined,
        });
        fs.mkdirSync(sessionDir(home, 'ws-1', 'agent-1', sessionId), { recursive: true });
        writeSessionYaml(home, 'ws-1', 'agent-1', sessionId, record);
        expect(readSessionYaml(home, 'ws-1', 'agent-1', sessionId)).toEqual(record);
      }
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

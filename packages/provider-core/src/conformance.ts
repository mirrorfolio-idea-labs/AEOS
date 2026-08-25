import { describe, expect, it } from 'vitest';
import { AeosEventSchema, type AgentConfig } from '@aeos/contracts';
import type { CapabilityMatrix, HarnessAdapter } from './adapter.js';

export interface ConformanceSubject {
  /** Fresh adapter per test — conformance must not depend on shared state. */
  makeAdapter: () => HarnessAdapter;
  /** A parseable AgentConfig the adapter can build a profile for. */
  agent: AgentConfig;
  /** Raw provider output samples `translate` must be pure and total on. */
  rawCorpus: readonly unknown[];
  /** The adapter's documented capabilities — reality must equal the claim. */
  capabilityClaims: CapabilityMatrix;
}

const FORBIDDEN_PROFILE_REFS = ['$HOME', '~/'];

/**
 * The bar every HarnessAdapter must clear (spec §9). Providers register
 * themselves by calling this from their own test suite — the capability
 * matrix and behavior are asserted here against docs/RELEASE-documented
 * claims, never hand-maintained in docs.
 */
export function describeAdapterConformance(name: string, subject: ConformanceSubject): void {
  const { makeAdapter, agent, rawCorpus, capabilityClaims } = subject;

  describe(`adapter conformance: ${name}`, () => {
    it('capabilities match its documented claims exactly (P2.M6.T3)', () => {
      const caps = makeAdapter().capabilities();
      expect(caps).toEqual(capabilityClaims);
      for (const key of ['resume', 'structuredOutput', 'mcp', 'sandbox', 'costReporting'] as const) {
        expect(typeof caps[key], `capability ${key}`).toBe('boolean');
      }
      if (caps.maxContextTokens !== undefined) {
        expect(caps.maxContextTokens).toBeGreaterThan(0);
      }
    });

    it('builds a hermetic profile (no home-directory references in env/argv)', async () => {
      const profile = await makeAdapter().createProfile(agent);
      expect(profile.rootDir.length).toBeGreaterThan(0);
      const strings = [...profile.argv, ...Object.entries(profile.env).flat()];
      for (const value of strings) {
        for (const forbidden of FORBIDDEN_PROFILE_REFS) {
          expect(value, `profile leaks ${forbidden}`).not.toContain(forbidden);
        }
      }
    });

    it('spawn streams schema-valid canonical events stamped with the AEOS session id', async () => {
      const adapter = makeAdapter();
      const profile = await adapter.createProfile(agent);
      const handle = adapter.spawn({ profile, sessionId: 'conf-sess', objective: 'conformance' });
      const events = [];
      for await (const event of handle.events) {
        events.push(AeosEventSchema.parse(event));
        expect(event.sessionId).toBe('conf-sess');
      }
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.type).toBe('session.created');
      expect(['session.completed', 'session.failed']).toContain(events.at(-1)?.type);
    });

    it('captures the provider session id from the stream', async () => {
      const adapter = makeAdapter();
      const profile = await adapter.createProfile(agent);
      const handle = adapter.spawn({ profile, sessionId: 'conf-sess', objective: 'conformance' });
      for await (const _ of handle.events) {
        // drain
      }
      expect(handle.providerSessionId).toBeDefined();
    });

    it('kill() ends the event stream', async () => {
      const adapter = makeAdapter();
      const profile = await adapter.createProfile(agent);
      const handle = adapter.spawn({ profile, sessionId: 'conf-sess', objective: 'conformance' });
      handle.kill();
      const events = [];
      for await (const event of handle.events) events.push(event);
      // A killed session must terminate promptly (reaching here at all is the
      // real assertion) and must not claim orderly completion.
      expect(events.map((e) => e.type)).not.toContain('session.completed');
    });

    it('translate() is pure and total on the fixture corpus', () => {
      const adapter = makeAdapter();
      for (const raw of rawCorpus) {
        const first = adapter.translate(raw);
        const second = adapter.translate(raw);
        expect(Array.isArray(first)).toBe(true);
        expect(second).toEqual(first);
        for (const event of first) AeosEventSchema.parse(event);
      }
      for (const garbage of [null, undefined, 42, 'x', {}, { type: 'nope' }]) {
        expect(() => adapter.translate(garbage)).not.toThrow();
      }
    });
  });
}

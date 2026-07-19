export type {
  CapabilityMatrix,
  HarnessAdapter,
  HarnessProfile,
  SessionHandle,
  SpawnOptions,
} from './adapter.js';
// conformance (vitest-dependent) lives behind '@aeos/provider-core/conformance'
// so the runtime entry point stays importable outside a test runner.
export { FakeAdapter, buildFixtureEvents, type FakeScript } from './provider-fake.js';

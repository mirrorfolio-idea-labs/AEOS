export type {
  CapabilityMatrix,
  HarnessAdapter,
  HarnessProfile,
  SessionHandle,
  SpawnOptions,
} from './adapter.js';
export { describeAdapterConformance, type ConformanceSubject } from './conformance.js';
export { FakeAdapter, buildFixtureEvents, type FakeScript } from './provider-fake.js';

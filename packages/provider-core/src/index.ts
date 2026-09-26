export type {
  CapabilityMatrix,
  CommandContext,
  HarnessAdapter,
  HarnessProfile,
  SessionHandle,
  SpawnOptions,
} from './adapter.js';
// conformance (vitest-dependent) lives behind '@aeos/provider-core/conformance'
// so the runtime entry point stays importable outside a test runner.
export { FakeAdapter, buildFixtureEvents, type FakeScript } from './provider-fake.js';
export { ADAPTER_MATRIX, type AdapterId } from './matrix.js';
export * from './binaries/index.js';
export {
  CONTAINER_HOME_LABEL,
  CONTAINER_LABEL,
  containerArgv,
  containerName,
  currentUser,
  dockerAvailable,
  gitCommonDir,
  homeLabelFor,
  reapContainers,
  type ContainerMount,
  type ContainerSpec,
} from './sandbox/container.js';

export {
  BinaryError,
  createBinaryManager,
  hashTree,
  matchesIntegrity,
  type BinaryErrorCode,
  type BinaryManager,
  type BinaryManagerOptions,
  type InstallRecord,
  type VerifiedBinary,
} from './manager.js';
export { DEFAULT_PINS, HARNESS_BIN, tarballUrl, type BinaryPin, type ManagedHarness } from './pins.js';
export {
  resolveHarnessCommand,
  type HarnessBinarySource,
  type HarnessBinarySpec,
  type ResolveDeps,
  type ResolvedHarness,
} from './resolve.js';
export {
  CAPABILITY_GATES,
  CapabilityVersionError,
  assertCapability,
  gateAdapter,
  supportsCapability,
  type GatedFeature,
} from './gates.js';
export { compareVersions, extractVersion, parseVersion } from './versions.js';

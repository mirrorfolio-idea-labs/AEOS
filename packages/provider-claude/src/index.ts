export {
  buildClaudeProfile,
  parseGeneratedSettings,
  type BuildClaudeProfileOptions,
  type GeneratedSettings,
  type SecretResolver,
} from './profile.js';
export { ClaudeStreamTranslator, type TranslateOptions } from './translate.js';
export { ClaudeAdapter, type ClaudeAdapterOptions, type RunChild } from './adapter.js';
export { buildResumeSpawn, type ResumeSpec } from './resume.js';
export {
  CREDENTIAL_FAILOVER_ACTION,
  evaluateUsageLimit,
  isUsageLimitFailure,
  type EvaluateUsageLimitOptions,
  type FailoverDecision,
  type UsageLimitPolicy,
} from './failover.js';

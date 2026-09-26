import { z } from 'zod';
import { SLUG_REGEX } from './workspace.js';

/** Hermetic-by-default harness feature toggles (spec D2, §9). */
export const FeatureTogglesSchema = z
  .object({
    plugins: z.boolean().default(false),
    skills: z.boolean().default(false),
    mcpServers: z.boolean().default(false),
    userClaudeMd: z.boolean().default(false),
    autoMemory: z.boolean().default(false),
  })
  .default({});

/**
 * A repository the agent may work on (spec §7 "repository bindings"). The
 * agent never edits `path` itself: every objective targeting the binding
 * gets its own git worktree under `<agent>/worktrees/<id>/<objective>` on
 * branch `aeos/<agent>/<objective>` (spec §10 isolation unit).
 */
export const RepoBindingSchema = z.object({
  id: z.string().regex(SLUG_REGEX),
  /** Absolute path of the user's checkout (the worktree source). */
  path: z.string().min(1),
  /** Branch/ref new objective worktrees start from; defaults to the checkout's HEAD. */
  baseRef: z.string().min(1).optional(),
  /**
   * Verification commands (P3.M3) run in the worktree after every code
   * task, e.g. `["pnpm test", "pnpm lint"]`. An objective may override.
   */
  verify: z.array(z.string().min(1)).optional(),
});
export type RepoBinding = z.infer<typeof RepoBindingSchema>;

/** The three first-party harnesses (core plugins living in-repo — spec §15). */
export const BUILTIN_PROVIDERS = ['claude-code', 'codex', 'opencode'] as const;
export type BuiltinProvider = (typeof BUILTIN_PROVIDERS)[number];
/** A third-party provider contributed by an installed plugin (P4.M2). */
export type PluginProviderId = `plugin:${string}`;
export const PLUGIN_PROVIDER_REGEX = /^plugin:[a-z0-9][a-z0-9-]{0,62}$/;
/**
 * Harness provider id: a builtin, or `plugin:<id>` for a provider an
 * installed plugin contributes. The cast only narrows the static type to
 * the template literal; at runtime (and in the JSON Schema) it is a
 * pattern-checked string.
 */
export const ProviderIdSchema = z.union([
  z.enum(BUILTIN_PROVIDERS),
  z.string().regex(PLUGIN_PROVIDER_REGEX) as unknown as z.ZodType<PluginProviderId>,
]);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

export const AgentConfigSchema = z.object({
  id: z.string().regex(SLUG_REGEX),
  workspaceId: z.string().regex(SLUG_REGEX),
  name: z.string().min(1),
  profile: z.string().optional(),
  avatar: z.string().optional(),
  harness: z.object({
    provider: ProviderIdSchema,
    /** Pinned harness version — resolved to a verified managed install (P2.M7). */
    version: z.string().optional(),
    /** Bring-your-own executable, used when no version is pinned (P2.M7.T2). */
    binaryPath: z.string().min(1).optional(),
    featureToggles: FeatureTogglesSchema,
  }),
  credentialProfileId: z.string().min(1),
  /**
   * Secret refs this agent may receive in its runner env — NAMES only,
   * never values; injection happens per effective policy (spec §11).
   */
  secrets: z.array(z.string().min(1)).optional(),
  modelPreferences: z.record(z.string()).optional(),
  repos: z.array(RepoBindingSchema).optional(),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

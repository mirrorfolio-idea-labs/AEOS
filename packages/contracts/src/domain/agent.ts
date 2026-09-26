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
});
export type RepoBinding = z.infer<typeof RepoBindingSchema>;

export const AgentConfigSchema = z.object({
  id: z.string().regex(SLUG_REGEX),
  workspaceId: z.string().regex(SLUG_REGEX),
  name: z.string().min(1),
  profile: z.string().optional(),
  avatar: z.string().optional(),
  harness: z.object({
    provider: z.enum(['claude-code', 'codex', 'opencode']),
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

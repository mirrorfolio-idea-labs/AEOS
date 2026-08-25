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

export const AgentConfigSchema = z.object({
  id: z.string().regex(SLUG_REGEX),
  workspaceId: z.string().regex(SLUG_REGEX),
  name: z.string().min(1),
  profile: z.string().optional(),
  avatar: z.string().optional(),
  harness: z.object({
    provider: z.enum(['claude-code', 'codex', 'opencode']),
    version: z.string().optional(),
    featureToggles: FeatureTogglesSchema,
  }),
  credentialProfileId: z.string().min(1),
  /**
   * Secret refs this agent may receive in its runner env — NAMES only,
   * never values; injection happens per effective policy (spec §11).
   */
  secrets: z.array(z.string().min(1)).optional(),
  modelPreferences: z.record(z.string()).optional(),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

import { z } from 'zod';

/**
 * Plugin ABI version (spec §15, P4.M2). `contracts` IS the plugin ABI;
 * this number moves only when what a plugin may rely on changes shape:
 * minor for additive changes, major for breaking ones. A plugin declares
 * the range it was built against; the loader refuses a mismatch with a
 * typed error instead of loading something that will misbehave later.
 */
export const PLUGIN_ABI_VERSION = '1.0.0';

export const PLUGIN_KINDS = [
  'provider',
  'memory-backend',
  'planner',
  'scheduler-job',
  'policy',
  'ui-panel',
  'deploy-target',
] as const;
export const PluginKindSchema = z.enum(PLUGIN_KINDS);
export type PluginKind = z.infer<typeof PluginKindSchema>;

/**
 * The `aeos` field of a plugin's package.json. `contract` is a semver
 * range over PLUGIN_ABI_VERSION (`^1`, `~1.0`, `1.0.0`, `>=1.0.0 <2`, `*`).
 */
export const PluginManifestSchema = z
  .object({
    contract: z.string().min(1),
    /** ES module (relative to the package root) exporting the plugin (default export). */
    entry: z.string().min(1),
    contributes: z
      .array(
        z
          .object({
            kind: PluginKindSchema,
            id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
            description: z.string().optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

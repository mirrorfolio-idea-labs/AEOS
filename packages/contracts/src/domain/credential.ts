import { z } from 'zod';

/**
 * Credential profiles (spec §9). Secrets are NEVER inline — `secretRef`
 * points into the daemon secret store. `.strict()` rejects stray keys like
 * `apiKey` so a literal secret cannot even parse.
 */
const base = z.object({ id: z.string().min(1) });

export const CredentialProfileSchema = z.discriminatedUnion('kind', [
  base.extend({ kind: z.literal('subscription') }).strict(),
  base.extend({ kind: z.literal('api-key'), secretRef: z.string().min(1) }).strict(),
  base
    .extend({
      kind: z.literal('gateway'),
      baseUrl: z.string().url(),
      secretRef: z.string().min(1),
      model: z.string().min(1).optional(),
    })
    .strict(),
]);
export type CredentialProfile = z.infer<typeof CredentialProfileSchema>;

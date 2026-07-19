import { z } from 'zod';

/**
 * Credential profiles (spec §9). Secrets are NEVER inline — `secretRef`
 * points into the daemon secret store. `.strict()` rejects stray keys like
 * `apiKey` so a literal secret cannot even parse.
 */
const base = z.object({ id: z.string().min(1) });

export const CredentialProfileSchema = z.discriminatedUnion('kind', [
  // `slot` names one concrete subscription account (e.g. "client-acme");
  // each slot gets its own persistent login home, so several agents can run
  // concurrently on different Claude Pro/Max accounts. Defaulted so
  // pre-slot profiles keep parsing.
  base.extend({ kind: z.literal('subscription'), slot: z.string().min(1).default('default') }).strict(),
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

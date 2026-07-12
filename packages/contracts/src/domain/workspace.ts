import { z } from 'zod';

export const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const WorkspaceSchema = z.object({
  id: z.string().regex(SLUG_REGEX),
  name: z.string().min(1),
  description: z.string().optional(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

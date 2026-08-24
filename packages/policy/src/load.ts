import fs from 'node:fs/promises';
import path from 'node:path';
import type { PolicyFile } from '@aeos/contracts';
import { PolicyFileSchema } from '@aeos/contracts';
import { parse } from 'yaml';
import { mergePolicyLayers } from './merge.js';

export interface LoadPolicyStackOptions {
  /** AEOS_HOME root. */
  home: string;
  workspaceId: string;
  agentId: string;
  /**
   * Directory holding an optional objective-level `policy.yaml` (the
   * most-specific layer). Omit when no objective is in play.
   */
  objectiveDir?: string;
}

function policyPath(home: string, workspaceId: string, agentId: string): string {
  return path.join(home, 'workspaces', workspaceId, 'agents', agentId, 'policy.yaml');
}

async function readLayer(file: string): Promise<PolicyFile | undefined> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch {
    return undefined; // absent layer = inherit upward; not an error
  }
  return PolicyFileSchema.parse(parse(text));
}

/**
 * Load and merge the full policy stack for one objective attempt:
 * workspace → agent → objective (most-specific wins). Files are optional;
 * malformed YAML throws loudly so a typo can never silently widen access.
 */
export async function loadPolicyStack(opts: LoadPolicyStackOptions) {
  const workspace = await readLayer(
    path.join(opts.home, 'workspaces', opts.workspaceId, 'policy.yaml'),
  );
  const agent = await readLayer(policyPath(opts.home, opts.workspaceId, opts.agentId));
  const objective = opts.objectiveDir === undefined
    ? undefined
    : await readLayer(path.join(opts.objectiveDir, 'policy.yaml'));
  return mergePolicyLayers([workspace, agent, objective]);
}

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import { TaskClassSchema, type AgentConfig, type TaskClass } from '@aeos/contracts';

const PROVIDERS = ['claude-code', 'codex', 'opencode'] as const;
export type RoutedProvider = (typeof PROVIDERS)[number];

export const RouteTargetSchema = z
  .object({
    provider: z.enum(PROVIDERS).optional(),
    model: z.string().min(1).optional(),
    /** Thinking effort hint (spec §13); recorded with the decision, passed where a harness supports it. */
    thinking: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  })
  .strict();
export type RouteTarget = z.infer<typeof RouteTargetSchema>;

/**
 * `routing.yaml` (home or workspace):
 * ```yaml
 * default: { provider: claude-code }
 * classes:
 *   plan: { model: claude-opus-5, thinking: high }
 *   implement: { provider: codex }
 * ```
 */
export const RoutingPolicySchema = z
  .object({
    default: RouteTargetSchema.optional(),
    classes: z.record(TaskClassSchema, RouteTargetSchema).optional(),
  })
  .strict();
export type RoutingPolicy = z.infer<typeof RoutingPolicySchema>;

/**
 * Built-in class → model defaults for Claude Code agents (spec §13's
 * architect/editor split): frontier model for planning and review,
 * mid-tier for implementation, small for mechanical work. Only applied
 * when the task runs on claude-code and nothing more specific set a
 * model; other harnesses keep their own default model.
 */
export const DEFAULT_CLAUDE_MODELS: Readonly<Record<Exclude<TaskClass, 'verify'>, string>> = {
  plan: 'claude-opus-5',
  architect: 'claude-opus-5',
  review: 'claude-opus-5',
  security_review: 'claude-opus-5',
  implement: 'claude-sonnet-5',
  refactor: 'claude-sonnet-5',
  summarize: 'claude-haiku-4-5',
  docs: 'claude-haiku-4-5',
  rename: 'claude-haiku-4-5',
};

const DEFAULT_THINKING: Partial<Record<TaskClass, RouteTarget['thinking']>> = {
  plan: 'high',
  architect: 'high',
  review: 'high',
  security_review: 'high',
};

export interface LayeredRouting {
  home?: RoutingPolicy | undefined;
  workspace?: RoutingPolicy | undefined;
}

function readPolicy(file: string): RoutingPolicy | undefined {
  if (!fs.existsSync(file)) return undefined;
  return RoutingPolicySchema.parse(parseYaml(fs.readFileSync(file, 'utf8')) ?? {});
}

export function loadRoutingPolicy(home: string, workspaceId: string): LayeredRouting {
  return {
    home: readPolicy(path.join(home, 'routing.yaml')),
    workspace: readPolicy(path.join(home, 'workspaces', workspaceId, 'routing.yaml')),
  };
}

export type RouteSource = 'agent' | 'workspace' | 'home' | 'default';

export interface RouteDecision {
  taskClass: TaskClass;
  provider: RoutedProvider;
  model: string | undefined;
  thinking: RouteTarget['thinking'];
  /** Which layer decided the provider and the model. */
  providerSource: RouteSource;
  modelSource: RouteSource | 'harness';
  reason: string;
}

/**
 * Resolve (provider, model, thinking) for one task class. Most specific
 * wins, field by field: agent `modelPreferences[class]` → workspace class
 * entry → home class entry → workspace default → home default → built-in.
 * The provider defaults to the agent's own harness.
 */
export function routeTask(agent: AgentConfig, taskClass: TaskClass, routing: LayeredRouting): RouteDecision {
  const layers: Array<[RouteSource, RouteTarget | undefined]> = [
    ['workspace', routing.workspace?.classes?.[taskClass]],
    ['home', routing.home?.classes?.[taskClass]],
    ['workspace', routing.workspace?.default],
    ['home', routing.home?.default],
  ];
  const pick = <K extends keyof RouteTarget>(key: K): [RouteTarget[K], RouteSource] | undefined => {
    for (const [source, target] of layers) {
      if (target?.[key] !== undefined) return [target[key], source];
    }
    return undefined;
  };

  const providerPick = pick('provider');
  const provider: RoutedProvider = providerPick?.[0] ?? agent.harness.provider;
  const providerSource: RouteSource = providerPick?.[1] ?? 'agent';

  let model: string | undefined;
  let modelSource: RouteDecision['modelSource'] = 'harness';
  const agentPref = agent.modelPreferences?.[taskClass];
  const modelPick = pick('model');
  if (agentPref !== undefined) {
    model = agentPref;
    modelSource = 'agent';
  } else if (modelPick !== undefined) {
    [model, modelSource] = modelPick;
  } else if (provider === 'claude-code' && taskClass !== 'verify') {
    model = DEFAULT_CLAUDE_MODELS[taskClass];
    modelSource = 'default';
  }
  const thinking = pick('thinking')?.[0] ?? DEFAULT_THINKING[taskClass];
  const reason = `${taskClass} → ${provider} (${providerSource})${model === undefined ? ', harness default model' : `, ${model} (${modelSource})`}`;
  return { taskClass, provider, model, thinking, providerSource, modelSource, reason };
}

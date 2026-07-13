import fs from 'node:fs';
import { AgentConfigSchema, SessionRecordSchema, type AgentConfig, type SessionRecord } from '@aeos/contracts';
import { parse, stringify } from 'yaml';
import { writeFileAtomic, type WriteFileAtomicOptions } from './atomic.js';
import { agentYaml, sessionYaml } from './paths.js';

/**
 * Minimal structural shape of a Zod schema's `safeParse`. Kernel does not
 * depend on `zod` directly (only `@aeos/contracts`, which re-exports Zod
 * schema instances) — this interface lets `readYaml`/`writeYaml` stay
 * generic over any contracts schema without adding a `zod` dependency here.
 */
interface SchemaLike<T> {
  safeParse(data: unknown):
    | { success: true; data: T }
    | { success: false; error: unknown };
}

/** Thrown when a YAML file fails to read, parse, or validate against its schema. */
export class CodecError extends Error {
  readonly path: string;
  override readonly cause?: unknown;

  constructor(path: string, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'CodecError';
    this.path = path;
    this.cause = options?.cause;
  }
}

function readYaml<T>(filePath: string, schema: SchemaLike<T>): T {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (cause) {
    throw new CodecError(filePath, `failed to read ${filePath}`, { cause });
  }

  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch (cause) {
    throw new CodecError(filePath, `failed to parse YAML at ${filePath}`, { cause });
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new CodecError(filePath, `schema validation failed for ${filePath}`, {
      cause: result.error,
    });
  }
  return result.data;
}

/** Validates BEFORE writing — invalid state is never persisted. */
function writeYaml<T>(
  filePath: string,
  schema: SchemaLike<T>,
  value: T,
  options?: WriteFileAtomicOptions,
): void {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new CodecError(filePath, `refusing to write invalid data to ${filePath}`, {
      cause: result.error,
    });
  }
  writeFileAtomic(filePath, stringify(result.data), options);
}

export function readAgentYaml(home: string, workspaceId: string, agentId: string): AgentConfig {
  return readYaml(agentYaml(home, workspaceId, agentId), AgentConfigSchema);
}

export function writeAgentYaml(
  home: string,
  workspaceId: string,
  agentId: string,
  config: AgentConfig,
  options?: WriteFileAtomicOptions,
): void {
  writeYaml(agentYaml(home, workspaceId, agentId), AgentConfigSchema, config, options);
}

export function readSessionYaml(
  home: string,
  workspaceId: string,
  agentId: string,
  sessionId: string,
): SessionRecord {
  return readYaml(sessionYaml(home, workspaceId, agentId, sessionId), SessionRecordSchema);
}

export function writeSessionYaml(
  home: string,
  workspaceId: string,
  agentId: string,
  sessionId: string,
  record: SessionRecord,
  options?: WriteFileAtomicOptions,
): void {
  writeYaml(
    sessionYaml(home, workspaceId, agentId, sessionId),
    SessionRecordSchema,
    record,
    options,
  );
}

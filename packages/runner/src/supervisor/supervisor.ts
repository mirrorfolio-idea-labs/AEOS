import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  newEventId,
  PROTOCOL_VERSION,
  type AeosEvent,
  type SessionRecord,
} from '@aeos/contracts';
import {
  agentDir,
  indexSession,
  listSubdirs,
  readSessionYaml,
  sessionDir,
  writeSessionYaml,
  type EventBus,
  type IndexDb,
} from '@aeos/kernel';
import { connectRunner, type RunnerClient } from '../protocol/client.js';
import type { RunnerOptions } from '../runner/runner.js';
import { transitionSession } from './session-state.js';

export interface SupervisorOptions {
  home: string;
  db: IndexDb;
  bus: EventBus;
  /** Path to the runner executable; defaults to this package's built main.js. */
  runnerMainPath?: string;
  heartbeatMs?: number;
  connectTimeoutMs?: number;
  exitGraceMs?: number;
}

export interface StartSessionOptions {
  workspaceId: string;
  agentId: string;
  childArgv: string[];
  sessionId?: string;
  hardTimeoutMs?: number;
}

export interface AdoptionReport {
  adopted: string[];
  orphaned: string[];
  failed: string[];
}

interface LiveSession {
  workspaceId: string;
  agentId: string;
  sessionId: string;
  client: RunnerClient;
  lastSeq: number;
}

export interface Supervisor {
  startSession(options: StartSessionOptions): Promise<SessionRecord>;
  /** Boot-time scan: reconnect to surviving runners, mark the rest (spec §10). */
  adoptOrphans(): Promise<AdoptionReport>;
  hasLiveRunner(sessionId: string): boolean;
  /** Asks the runner to stop its child gracefully. */
  stopSession(sessionId: string, reason: string): void;
  /**
   * Daemon-shutdown semantics: drops connections and forgets live sessions but
   * leaves runner processes alive — that is the whole point of the topology.
   */
  close(): void;
}

function defaultRunnerMainPath(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'runner', 'main.js');
}

export function createSupervisor(options: SupervisorOptions): Supervisor {
  const { home, db, bus } = options;
  const runnerMainPath = options.runnerMainPath ?? defaultRunnerMainPath();
  const live = new Map<string, LiveSession>();

  function publish(
    sessionId: string,
    agentId: string,
    type: 'session.created' | 'session.orphaned',
  ): void {
    bus.publish({
      v: PROTOCOL_VERSION,
      id: newEventId(),
      ts: new Date().toISOString(),
      source: 'supervisor',
      agentId,
      sessionId,
      type,
      payload: {},
    } as AeosEvent);
  }

  async function connectAndTrack(
    workspaceId: string,
    agentId: string,
    sessionId: string,
    socketPath: string,
    fromSeq: number,
  ): Promise<RunnerClient> {
    const client = await connectRunner({
      socketPath,
      sessionId,
      fromSeq,
      connectTimeoutMs: options.connectTimeoutMs ?? 5000,
      onEvent: (seq, event) => {
        const entry = live.get(sessionId);
        if (entry !== undefined) entry.lastSeq = seq;
        bus.publish(event); // runner owns the transcript; the bus serves live consumers
      },
      onDisconnect: () => {
        live.delete(sessionId);
      },
    });
    live.set(sessionId, { workspaceId, agentId, sessionId, client, lastSeq: fromSeq });
    return client;
  }

  return {
    async startSession(startOptions: StartSessionOptions): Promise<SessionRecord> {
      const { workspaceId, agentId, childArgv } = startOptions;
      const sessionId = startOptions.sessionId ?? newEventId();
      const dir = sessionDir(home, workspaceId, agentId, sessionId);
      fs.mkdirSync(dir, { recursive: true });
      const socketPath = path.join(dir, 'runner.sock');

      let record: SessionRecord = { id: sessionId, agentId, state: 'created' };
      writeSessionYaml(home, workspaceId, agentId, sessionId, record);
      indexSession(db, record, Date.now());
      publish(sessionId, agentId, 'session.created');

      record = transitionSession({ home, db, bus, workspaceId, agentId, sessionId, to: 'starting' });

      const runnerConfig: RunnerOptions & { exitGraceMs?: number } = {
        sessionId,
        sessionDir: dir,
        socketPath,
        childArgv,
        agentId,
        ...(options.heartbeatMs !== undefined ? { heartbeatMs: options.heartbeatMs } : {}),
        ...(startOptions.hardTimeoutMs !== undefined
          ? { hardTimeoutMs: startOptions.hardTimeoutMs }
          : {}),
        ...(options.exitGraceMs !== undefined ? { exitGraceMs: options.exitGraceMs } : {}),
        stopFilePaths: [path.join(home, 'STOP'), path.join(dir, 'STOP')],
      };
      const child = spawn(
        process.execPath,
        [runnerMainPath, JSON.stringify(runnerConfig)],
        { detached: true, stdio: 'ignore' },
      );
      child.unref();

      record = {
        ...record,
        ...(child.pid !== undefined ? { runnerPid: child.pid } : {}),
        runnerSocket: socketPath,
      };
      writeSessionYaml(home, workspaceId, agentId, sessionId, record);
      indexSession(db, record, Date.now());

      try {
        await retryConnect(() =>
          connectAndTrack(workspaceId, agentId, sessionId, socketPath, 0),
          options.connectTimeoutMs ?? 5000,
        );
      } catch (error) {
        transitionSession({ home, db, bus, workspaceId, agentId, sessionId, to: 'failed' });
        throw error;
      }

      return transitionSession({ home, db, bus, workspaceId, agentId, sessionId, to: 'running' });
    },

    async adoptOrphans(): Promise<AdoptionReport> {
      const report: AdoptionReport = { adopted: [], orphaned: [], failed: [] };
      for (const workspaceId of listSubdirs(path.join(home, 'workspaces'))) {
        for (const agentId of listSubdirs(
          path.join(home, 'workspaces', workspaceId, 'agents'),
        )) {
          const sessionsDir = path.join(agentDir(home, workspaceId, agentId), 'sessions');
          for (const sessionId of listSubdirs(sessionsDir)) {
            let record: SessionRecord;
            try {
              record = readSessionYaml(home, workspaceId, agentId, sessionId);
            } catch {
              continue; // corrupt session files are reindex's problem, not adoption's
            }
            if (record.state !== 'running' && record.state !== 'starting') continue;

            const markLost = (rec: SessionRecord): void => {
              if (rec.state === 'running') {
                transitionSession({ home, db, bus, workspaceId, agentId, sessionId, to: 'orphaned' });
                publish(sessionId, agentId, 'session.orphaned');
                report.orphaned.push(sessionId);
              } else {
                // `starting` never reached running — the runner is simply gone
                transitionSession({ home, db, bus, workspaceId, agentId, sessionId, to: 'failed' });
                report.failed.push(sessionId);
              }
            };

            if (record.runnerSocket === undefined) {
              markLost(record);
              continue;
            }
            try {
              await connectAndTrack(workspaceId, agentId, sessionId, record.runnerSocket, 0);
              if (record.state === 'starting') {
                transitionSession({ home, db, bus, workspaceId, agentId, sessionId, to: 'running' });
              }
              report.adopted.push(sessionId);
            } catch {
              markLost(record);
            }
          }
        }
      }
      return report;
    },

    hasLiveRunner(sessionId: string): boolean {
      return live.has(sessionId);
    },

    stopSession(sessionId: string, reason: string): void {
      live.get(sessionId)?.client.stop(reason);
    },

    close(): void {
      for (const entry of live.values()) entry.client.close();
      live.clear();
    },
  };
}

async function retryConnect<T>(attempt: () => Promise<T>, deadlineMs: number): Promise<T> {
  const deadline = Date.now() + deadlineMs;
  let lastError: unknown;
  for (;;) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
      if (Date.now() > deadline) throw lastError;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

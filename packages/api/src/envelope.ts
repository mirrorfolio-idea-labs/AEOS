import type { FastifyReply } from 'fastify';
import { ZodError } from 'zod';

/** Spec §14 response envelope — every route returns exactly this shape. */
export interface Envelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  meta?: { total?: number; page?: number; limit?: number };
}

export const ok = <T>(data: T, meta?: Envelope<T>['meta']): Envelope<T> => ({
  success: true,
  data,
  error: null,
  ...(meta === undefined ? {} : { meta }),
});

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Central error → envelope mapping (T1 accept): zod = 400, ApiError = its code, else 500. */
export function sendError(reply: FastifyReply, error: unknown): void {
  if (error instanceof ZodError) {
    void reply
      .status(400)
      .send({ success: false, data: null, error: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    return;
  }
  if (error instanceof ApiError) {
    void reply.status(error.statusCode).send({ success: false, data: null, error: error.message });
    return;
  }
  void reply.status(500).send({
    success: false,
    data: null,
    error: error instanceof Error ? error.message : 'internal error',
  });
}

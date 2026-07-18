/**
 * Length-prefixed framing for the daemon↔runner wire (spec §10): each frame is
 * a 4-byte big-endian byte length followed by that many bytes of UTF-8 JSON.
 * The decoder is an incremental state machine — it never assumes one chunk
 * equals one frame (Unix sockets guarantee neither message boundaries nor
 * chunk sizes).
 */

/** Hard cap per frame; anything larger is a protocol violation, not data. */
export const MAX_FRAME_BYTES = 1024 * 1024;

export class FrameSizeError extends Error {
  constructor(bytes: number) {
    super(`frame of ${bytes} bytes exceeds the ${MAX_FRAME_BYTES}-byte limit`);
    this.name = 'FrameSizeError';
  }
}

export function encodeFrame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  if (body.length > MAX_FRAME_BYTES) throw new FrameSizeError(body.length);
  const frame = Buffer.allocUnsafe(4 + body.length);
  frame.writeUInt32BE(body.length, 0);
  body.copy(frame, 4);
  return frame;
}

export class FrameDecoder {
  private buffered = Buffer.alloc(0);

  /** Feed a chunk; returns every complete message it finishes. */
  push(chunk: Buffer): unknown[] {
    this.buffered = this.buffered.length === 0 ? chunk : Buffer.concat([this.buffered, chunk]);
    const messages: unknown[] = [];
    while (this.buffered.length >= 4) {
      const bodyLength = this.buffered.readUInt32BE(0);
      if (bodyLength > MAX_FRAME_BYTES) throw new FrameSizeError(bodyLength);
      if (this.buffered.length < 4 + bodyLength) break;
      const body = this.buffered.subarray(4, 4 + bodyLength);
      this.buffered = this.buffered.subarray(4 + bodyLength);
      messages.push(JSON.parse(body.toString('utf8')));
    }
    return messages;
  }
}

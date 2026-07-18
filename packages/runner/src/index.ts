export {
  encodeFrame,
  FrameDecoder,
  FrameSizeError,
  MAX_FRAME_BYTES,
} from './protocol/frames.js';
export {
  negotiateVersion,
  parseWireMessage,
  SUPPORTED_VERSIONS,
  VersionMismatchError,
  WireMessageSchema,
  type EventMessage,
  type Hello,
  type HelloAck,
  type VersionRange,
  type WireMessage,
} from './protocol/messages.js';

import { monotonicFactory } from 'ulid';

const ulid = monotonicFactory();

/** ULID: 26 chars of Crockford base32, lexicographically time-sortable. */
export const ULID_REGEX = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;

export function newEventId(): string {
  return ulid();
}

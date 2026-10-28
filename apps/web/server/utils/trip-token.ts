import { createHash, randomBytes } from 'node:crypto';

/** A new Trip link token: 256 random bits, URL-safe so it fits in the link as is. */
export function createTripToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * The form a token is stored and looked up in. A plain hash is enough: the token is
 * random, so there is nothing to brute-force, and a database leak reveals no Trip links.
 */
export function hashTripToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

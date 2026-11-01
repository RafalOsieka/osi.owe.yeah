import { createHash } from 'node:crypto';

/**
 * The form a token is stored and looked up in. A plain hash is enough: the token is
 * random, so there is nothing to brute-force, and a database leak reveals no Trip links.
 */
export function hashTripToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

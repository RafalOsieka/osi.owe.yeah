/**
 * A new Trip link token (`tripTokenSchema`): 256 bits from the platform's secure random
 * source, base64url. Made by the device that creates the Trip (ADR 0001).
 */
export function newTripToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

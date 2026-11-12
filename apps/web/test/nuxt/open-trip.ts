import { openTripKey, type OpenTrip } from '../../app/composables/useOpenTrip';

/**
 * Mount options that provide `openTrip` to the mounted screen, as `pages/trips/[id].vue` does.
 * Build it with `fromPartial`, giving only what the screen reads.
 */
export function withOpenTrip(openTrip: OpenTrip) {
  return { global: { provide: { [openTripKey]: openTrip } } };
}

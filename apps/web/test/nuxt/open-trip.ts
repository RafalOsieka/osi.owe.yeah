import { fromPartial, type PartialDeep } from '@total-typescript/shoehorn';
import { openTripKey, type OpenTrip } from '../../app/composables/useOpenTrip';

/**
 * Mount options that provide an Open Trip to the mounted screen, as `pages/trips/[id].vue`
 * does. Give only what the screen reads (a Participant's avatar reads the Trip's
 * `participants` and `removedParticipants`); it is checked against the real `OpenTrip` type.
 */
export function withOpenTrip(openTrip: PartialDeep<OpenTrip>) {
  return { global: { provide: { [openTripKey]: fromPartial<OpenTrip>(openTrip) } } };
}

import type { Currency, Participant } from '@osi/owe-yeah-domain';
import type { InjectionKey } from 'vue';
import type { DeviceNotifications, Notice } from '~/sync/db';
import type { TripHandle } from '~/sync/device';
import type { LocalTrip } from '~/sync/local-trip';
import type { AvatarColor } from '~/utils/avatar';

/**
 * The Trip open on screen, as `pages/trips/[id].vue` offers it to its pages and to the Trip
 * layout: the device's handle for the Trip (`TripHandle`, where each call is documented), the
 * Trip as the device reads it, kept live, and what only the screen does. Every change is saved
 * on the device first and syncs by itself (ADR 0002), so none of them waits for the network.
 */
export interface OpenTrip extends Omit<TripHandle, 'claim' | 'forget'> {
  /** The Trip as this device shows it, its changes not synced yet included. */
  trip: Readonly<Ref<LocalTrip>>;
  /** The Participant this device says it is in the Trip, if it has said. */
  claim: Readonly<Ref<Participant | null>>;
  /** The currency of the Expense last saved on this device, which a new one starts in. */
  lastCurrency: Readonly<Ref<Currency | null>>;
  /** How many of this device's changes to the Trip the server has not accepted yet. */
  unsynced: Readonly<Ref<number>>;
  /**
   * Every Participant the Trip has had, removed ones included: to name them on older
   * versions and deleted Expenses. New Expenses only pick from `trip.participants`.
   */
  everyone: Readonly<Ref<Participant[]>>;
  /** What sync has to tell about this device's changes, until dismissed. */
  notices: Readonly<Ref<Notice[]>>;
  /** Push notifications for the Trip on this device (#41). */
  notifications: Readonly<Ref<DeviceNotifications>>;
  /** Opens My Trips, then forgets the Trip on this device, losing changes not synced yet. */
  forget(): Promise<void>;
  /** Opens the "Who are you?" sheet. */
  askWhoYouAre(): void;
  /** Opens Invite, which passes on the Trip link once the Trip has synced. */
  invite(): void;
  /** The Trip link to pass on, once the Trip has synced; `null` before. */
  link: Readonly<Ref<string | null>>;
}

const openTripKey: InjectionKey<OpenTrip> = Symbol('open-trip');

export function provideOpenTrip(openTrip: OpenTrip): void {
  provide(openTripKey, openTrip);
}

/** The open Trip, from anywhere under `pages/trips/[id].vue`. */
export function useOpenTrip(): OpenTrip {
  const openTrip = inject(openTripKey);
  if (!openTrip) throw new Error('useOpenTrip() is only available inside an open Trip');
  return openTrip;
}

/**
 * A Participant's avatar color: by their place among everyone the open Trip has had
 * (`participantAvatarColors`), so no two of its first six share one; by their id only when
 * the Trip doesn't know them, or outside a Trip.
 */
export function useAvatarColor(): (participantId: string) => AvatarColor {
  const openTrip = inject(openTripKey, null);
  const colors = computed(() =>
    openTrip ? participantAvatarColors(openTrip.trip.value) : new Map<string, AvatarColor>(),
  );
  return (participantId) => colors.value.get(participantId) ?? avatarColor(participantId);
}

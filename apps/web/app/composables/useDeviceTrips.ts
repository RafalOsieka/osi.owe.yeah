import {
  participantSchema,
  tripIdSchema,
  tripNameSchema,
  type Participant,
  type TripWithParticipants,
} from '@osi/owe-yeah-domain';
import { z } from 'zod';

/**
 * A Trip opened on this device: what My Trips lists and how it reopens the Trip link.
 * The Claim is the Participant this device says it is, stored with their name so My Trips
 * can show it without a pull. A Claim grants no rights; it only sets defaults and
 * highlighting.
 */
const deviceTripSchema = z.object({
  id: tripIdSchema,
  name: tripNameSchema,
  token: z.string().min(1),
  claim: participantSchema.nullable(),
  openedAt: z.iso.datetime(),
});

export type DeviceTrip = z.infer<typeof deviceTripSchema>;

const STORAGE_KEY = 'owe-yeah:trips';

// Read once per app load; anything unreadable is dropped rather than breaking the app.
function load(): DeviceTrip[] {
  try {
    const parsed = z
      .array(deviceTripSchema)
      .safeParse(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

let deviceTrips: Ref<DeviceTrip[]> | undefined;

/**
 * The Trips opened on this device with their Claims, kept in `localStorage` until the
 * device's local Trip store arrives. Shared by every caller and saved on every change.
 */
export function useDeviceTrips() {
  if (!deviceTrips) {
    const trips = ref(load());
    // Every change replaces the list, so a shallow watch sees them all.
    watch(trips, (value) => localStorage.setItem(STORAGE_KEY, JSON.stringify(value)));
    deviceTrips = trips;
  }
  const trips = deviceTrips;

  /** Most recently opened first. */
  const opened = computed(() =>
    trips.value.toSorted((a, b) => b.openedAt.localeCompare(a.openedAt)),
  );

  function find(tripId: string): DeviceTrip | undefined {
    return trips.value.find(({ id }) => id === tripId);
  }

  /** Records that a Trip was opened, keeping its Claim and refreshing the claimed name. */
  function remember(trip: TripWithParticipants, token: string): void {
    const known = find(trip.id);
    const claimed =
      trip.participants.find(({ id }) => id === known?.claim?.id) ?? known?.claim ?? null;
    const entry: DeviceTrip = {
      id: trip.id,
      name: trip.name,
      token,
      claim: claimed,
      openedAt: new Date().toISOString(),
    };
    trips.value = [...trips.value.filter(({ id }) => id !== trip.id), entry];
  }

  /** Sets which Participant this device is in a Trip it has opened. */
  function claim(tripId: string, participant: Participant): void {
    trips.value = trips.value.map((known) =>
      known.id === tripId ? { ...known, claim: participant } : known,
    );
  }

  return { opened, find, remember, claim };
}

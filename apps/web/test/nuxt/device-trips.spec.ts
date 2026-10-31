import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TripWithParticipants } from '@osi/owe-yeah-domain';

const trip: TripWithParticipants = {
  id: '019a2b3c-4d5e-7f00-8a1b-2c3d4e5f6a7b',
  name: 'Croatia 2026',
  currency: 'EUR',
  participants: [{ id: '019a2b3c-4d5e-7f00-8a1b-2c3d4e5f6a7c', name: 'Ania' }],
};

// A fresh copy of the composable, as after the app is reloaded on the same device.
async function reloadedDeviceTrips() {
  vi.resetModules();
  const { useDeviceTrips } = await import('../../app/composables/useDeviceTrips');
  return useDeviceTrips();
}

describe('useDeviceTrips', () => {
  beforeEach(() => localStorage.clear());

  it("keeps the Trip link's token with the Trip after a reload", async () => {
    (await reloadedDeviceTrips()).remember(trip, 'the-token');

    expect((await reloadedDeviceTrips()).find(trip.id)?.token).toBe('the-token');
  });

  it('keeps the Claim when the Trip is opened again with a new token', async () => {
    const device = await reloadedDeviceTrips();
    device.remember(trip, 'the-token');
    device.claim(trip.id, trip.participants[0]!);
    device.remember(trip, 'a-new-token');

    const reloaded = (await reloadedDeviceTrips()).find(trip.id);
    expect(reloaded).toMatchObject({ token: 'a-new-token', claim: { name: 'Ania' } });
  });
});

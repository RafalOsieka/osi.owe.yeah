import 'fake-indexeddb/auto';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it } from 'vitest';
import { DeviceDb } from '../../app/sync/db';
import { createDevice, OfflineError, type Transport } from '../../app/sync/device';
import { newTrip, participant, plainExpense } from '../e2e/harness/trip-builders';

// The device's sync is tested against the real Trip sync (`test/db/device`, ADR 0004); these
// tests never reach a server, as with no signal at all.
const noSignal = () => Promise.reject(new OfflineError());
const unreachable: Transport = {
  push: noSignal,
  pull: noSignal,
  lookupRate: noSignal,
  revisions: noSignal,
  subscribe: noSignal,
  unsubscribe: noSignal,
  reminderStatus: noSignal,
  remind: noSignal,
};

const kasia = participant('Kasia');
const ania = participant('Ania');
const trip = newTrip('Croatia 2026', [kasia, ania]);

function setUp() {
  return createDevice(new DeviceDb(uuidv7()), unreachable, uuidv7());
}

describe('the device', () => {
  it('refuses an Expense that breaks a Trip rule before queueing it', async () => {
    const device = setUp();
    await device.createTrip(trip, 'x'.repeat(43));

    const problems = await device
      .trip(trip.id)
      .saveExpense(
        { ...plainExpense(kasia, [kasia, ania], { title: 'Pizza' }), mainPayerId: uuidv7() },
        null,
      );

    expect(problems).toEqual(['unknownMainPayer']);
    expect((await device.read(trip.id))?.local?.expenses).toEqual([]);
  });

  it('remembers the currency of the Expense it saved last in the Trip', async () => {
    const device = setUp();
    await device.createTrip(trip, 'x'.repeat(43));
    expect((await device.read(trip.id))?.deviceTrip.lastCurrency).toBe(null);

    await device
      .trip(trip.id)
      .saveExpense(
        { ...plainExpense(kasia, [kasia, ania], { title: 'Langos' }), currency: 'HUF' },
        null,
      );

    expect((await device.read(trip.id))?.deviceTrip.lastCurrency).toBe('HUF');
  });
});

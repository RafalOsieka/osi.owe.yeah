import 'fake-indexeddb/auto';
import type { Expense, TripWithParticipants } from '@osi/owe-yeah-domain';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it } from 'vitest';
import { DeviceDb } from '../../app/sync/db';
import { createDevice, type Transport } from '../../app/sync/device';

// The device's sync is tested against the real Trip sync (`test/db/device`, ADR 0004); these
// tests never reach a server, as with no signal at all.
const noSignal = () => Promise.reject(new Error('offline'));
const unreachable: Transport = {
  push: noSignal,
  pull: noSignal,
  revisions: noSignal,
  subscribe: noSignal,
  unsubscribe: noSignal,
  reminderStatus: noSignal,
  remind: noSignal,
};

const kasia = { id: uuidv7(), name: 'Kasia' };
const ania = { id: uuidv7(), name: 'Ania' };

const trip: TripWithParticipants = {
  id: uuidv7(),
  name: 'Croatia 2026',
  currency: 'EUR',
  participants: [kasia, ania],
};

function setUp() {
  return createDevice(new DeviceDb(uuidv7()), unreachable, uuidv7());
}

function plainExpense(title: string): Expense {
  return {
    id: uuidv7(),
    title,
    currency: 'EUR',
    time: { instant: '2026-07-14T21:30:00Z', zone: 'Europe/Zagreb' },
    mainPayerId: kasia.id,
    lineItems: [
      {
        name: '',
        unitPrice: 2450,
        quantity: 1,
        split: { mode: 'even', participantIds: [kasia.id, ania.id] },
      },
    ],
  };
}

describe('the device', () => {
  it('refuses an Expense that breaks a Trip rule before queueing it', async () => {
    const device = setUp();
    await device.createTrip(trip, 'x'.repeat(43));

    const problems = await device
      .trip(trip.id)
      .saveExpense({ ...plainExpense('Pizza'), mainPayerId: uuidv7() }, null);

    expect(problems).toEqual(['unknownMainPayer']);
    expect((await device.read(trip.id))?.local?.expenses).toEqual([]);
  });

  it('remembers the currency of the Expense it saved last in the Trip', async () => {
    const device = setUp();
    await device.createTrip(trip, 'x'.repeat(43));
    expect((await device.read(trip.id))?.deviceTrip.lastCurrency).toBe(null);

    await device.trip(trip.id).saveExpense({ ...plainExpense('Langos'), currency: 'HUF' }, null);

    expect((await device.read(trip.id))?.deviceTrip.lastCurrency).toBe('HUF');
  });
});

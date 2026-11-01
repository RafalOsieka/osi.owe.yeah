import { Dexie } from 'dexie';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it } from 'vitest';
import { DeviceDb } from '../../app/sync/db';

describe('the device store', () => {
  it('keeps the Trips opened before it existed, with their Trip links and Claims', async () => {
    const ania = { id: uuidv7(), name: 'Ania' };
    const opened = {
      id: uuidv7(),
      name: 'Croatia 2026',
      token: 'the-token',
      claim: ania,
      openedAt: '2026-07-01T10:00:00.000Z',
    };
    localStorage.setItem('owe-yeah:trips', JSON.stringify([opened, { id: 'unreadable' }]));

    const trips = await new DeviceDb(uuidv7()).trips.toArray();

    expect(trips).toEqual([
      {
        id: opened.id,
        token: 'the-token',
        claim: ania,
        openedAt: opened.openedAt,
        snapshot: null,
      },
    ]);
  });

  it('keeps Expenses kept before deletes and Revisions as live, and pulls their Trip again', async () => {
    const name = uuidv7();
    const lidl = {
      id: uuidv7(),
      title: 'Lidl Rovinj',
      currency: 'EUR',
      time: { instant: '2026-07-14T21:30:00Z', zone: 'Europe/Zagreb' },
      mainPayerId: uuidv7(),
      lineItems: [],
    };
    const meta = { claimId: null, deviceId: uuidv7() };
    const v1 = new Dexie(name);
    v1.version(1).stores({ trips: 'id', outbox: '++seq, tripId' });
    const tripId = uuidv7();
    await v1.table('trips').add({
      id: tripId,
      token: 'the-token',
      claim: null,
      openedAt: '2026-07-01T10:00:00.000Z',
      snapshot: {
        id: tripId,
        name: 'Croatia 2026',
        currency: 'EUR',
        participants: [],
        version: 7,
        expenses: [{ ...lidl, version: 2 }],
      },
    });
    const conflict = { changeId: uuidv7(), status: 'conflict', current: { ...lidl, version: 3 } };
    await v1.table('outbox').add({
      tripId,
      change: { ...meta, id: uuidv7(), kind: 'expense', base: { version: 2 }, expense: lidl },
      held: { ...conflict, currentClaimId: null },
    });
    v1.close();

    const db = new DeviceDb(name);
    const [trip] = await db.trips.toArray();
    const [entry] = await db.outbox.toArray();

    expect(trip?.snapshot).toMatchObject({
      version: 0,
      expenses: [{ ...lidl, version: 2, deleted: false, edited: null }],
    });
    expect(entry).toMatchObject({
      change: { expense: lidl, deleted: false },
      held: { current: { ...lidl, version: 3, deleted: false, edited: null } },
    });
  });
});

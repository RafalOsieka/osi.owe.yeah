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
        rates: [],
        lastCurrency: null,
        notices: [],
        notifications: { subscription: null, offered: false, registered: null },
        acceptedVersions: {},
      },
    ]);
  });

  it('runs every link of the migration chain on a store kept by version 1, Trips and outbox', async () => {
    const name = uuidv7();
    const line = { unitPrice: 2450, split: { mode: 'even', participantIds: [] } };
    const lidl = {
      id: uuidv7(),
      title: 'Lidl Rovinj',
      currency: 'EUR',
      time: { instant: '2026-07-14T21:30:00Z', zone: 'Europe/Zagreb' },
      mainPayerId: uuidv7(),
      lineItems: [line],
    };
    const ania = { id: uuidv7(), name: 'Ania' };
    const meta = { claimId: null, deviceId: uuidv7() };
    const v1 = new Dexie(name);
    v1.version(1).stores({ trips: 'id', outbox: '++seq, tripId' });
    const tripId = uuidv7();
    const v1Trip = { id: tripId, name: 'Croatia 2026', currency: 'EUR', participants: [ania] };
    await v1.table('trips').add({
      id: tripId,
      token: 'the-token',
      claim: ania,
      openedAt: '2026-07-01T10:00:00.000Z',
      snapshot: { ...v1Trip, version: 7, expenses: [{ ...lidl, version: 2 }] },
    });
    const change = { ...meta, id: uuidv7(), kind: 'expense', base: { version: 2 } };
    await v1.table('outbox').add({ tripId, change: { ...change, expense: lidl }, held: null });
    v1.close();

    const db = new DeviceDb(name);
    const [trip] = await db.trips.toArray();
    const [entry] = await db.outbox.toArray();

    const migrated = { ...lidl, lineItems: [{ ...line, name: '', quantity: 1 }] };
    expect(trip).toMatchObject({
      rates: [],
      lastCurrency: null,
      notices: [],
      notifications: { subscription: null, offered: false, registered: null },
      acceptedVersions: {},
      snapshot: {
        ...v1Trip,
        version: 0,
        edited: null,
        removedParticipants: [],
        expenses: [{ ...migrated, version: 2, deleted: false, edited: null }],
      },
    });
    expect(entry?.change).toEqual({ ...change, expense: migrated, deleted: false });
    expect(await db.forgotten.toArray()).toEqual([]);
  });
});

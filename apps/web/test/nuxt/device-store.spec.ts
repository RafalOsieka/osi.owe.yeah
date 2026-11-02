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

  it('reads Expenses kept before Receipts as one unnamed unit, in the Trip and the outbox', async () => {
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
    const stored = { ...lidl, version: 2, deleted: false, edited: null };
    const meta = { claimId: null, deviceId: uuidv7() };
    const v2 = new Dexie(name);
    v2.version(2).stores({ trips: 'id', outbox: '++seq, tripId' });
    const tripId = uuidv7();
    await v2.table('trips').add({
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
        expenses: [stored],
      },
    });
    const change = { ...meta, id: uuidv7(), kind: 'expense', base: { version: 2 }, deleted: false };
    await v2.table('outbox').add({
      tripId,
      change: { ...change, expense: lidl },
      held: { changeId: change.id, status: 'conflict', current: stored, currentClaimId: null },
    });
    v2.close();

    const db = new DeviceDb(name);
    const [trip] = await db.trips.toArray();
    const [entry] = await db.outbox.toArray();

    const migrated = { ...lidl, lineItems: [{ ...line, name: '', quantity: 1 }] };
    expect(trip?.snapshot?.expenses).toEqual([{ ...stored, ...migrated }]);
    expect(entry?.change).toEqual({ ...change, expense: migrated });
    expect(entry?.held).toMatchObject({ current: { ...stored, ...migrated } });
  });

  it('keeps Participants queued before removal as kept, and pulls their Trip again', async () => {
    const name = uuidv7();
    const ania = { id: uuidv7(), name: 'Ania' };
    const v3 = new Dexie(name);
    v3.version(3).stores({ trips: 'id', outbox: '++seq, tripId' });
    const tripId = uuidv7();
    const snapshot = {
      id: tripId,
      name: 'Croatia 2026',
      currency: 'EUR',
      participants: [ania],
      version: 7,
      expenses: [],
    };
    await v3.table('trips').add({
      id: tripId,
      token: 'the-token',
      claim: ania,
      openedAt: '2026-07-01T10:00:00.000Z',
      snapshot,
    });
    const change = { claimId: null, deviceId: uuidv7(), id: uuidv7(), kind: 'participant' };
    await v3.table('outbox').add({ tripId, change: { ...change, participant: ania }, held: null });
    v3.close();

    const db = new DeviceDb(name);
    const [trip] = await db.trips.toArray();
    const [entry] = await db.outbox.toArray();

    expect(trip).toMatchObject({
      notices: [],
      snapshot: { ...snapshot, version: 0, edited: null, removedParticipants: [] },
    });
    expect(entry?.change).toEqual({ ...change, participant: ania, removed: false });
  });

  it('sends again an Expense refused for not being in the Trip currency, and drops the notes of a refused Trip currency', async () => {
    const name = uuidv7();
    const v4 = new Dexie(name);
    v4.version(4).stores({ trips: 'id', outbox: '++seq, tripId' });
    const tripId = uuidv7();
    const removed = {
      id: uuidv7(),
      kind: 'removalRefused',
      participant: { id: uuidv7(), name: 'Ola' },
    };
    await v4.table('trips').add({
      id: tripId,
      token: 'the-token',
      claim: null,
      openedAt: '2026-07-01T10:00:00.000Z',
      snapshot: null,
      notices: [removed, { id: uuidv7(), kind: 'currencyRefused', currency: 'PLN' }],
    });
    const rejected = (problems: string[]) => ({
      tripId,
      change: { id: uuidv7(), kind: 'expense' },
      held: { changeId: uuidv7(), status: 'rejected', problems },
    });
    await v4
      .table('outbox')
      .bulkAdd([
        rejected(['currencyNotTripCurrency']),
        rejected(['currencyNotTripCurrency', 'unknownMainPayer']),
      ]);
    v4.close();

    const db = new DeviceDb(name);
    const [trip] = await db.trips.toArray();
    const entries = await db.outbox.toArray();

    expect(trip).toMatchObject({ rates: [], lastCurrency: null, notices: [removed] });
    expect(entries.map(({ held }) => held && held.status === 'rejected' && held.problems)).toEqual([
      null,
      ['unknownMainPayer'],
    ]);
  });
});

import 'fake-indexeddb/auto';
import { randomBytes } from 'node:crypto';
import {
  PARTICIPANT_LIMIT,
  type Expense,
  type Participant,
  type RateEntry,
  type ServerTrip,
  type TripWithParticipants,
} from '@osi/owe-yeah-domain';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, expect, it, onTestFinished, vi } from 'vitest';
import { DeviceDb } from '../../../app/sync/db';
import { createDevice, OfflineError } from '../../../app/sync/device';
import { toExpense } from '../../../app/sync/local-trip';
import { changes } from '../../../server/db/schema';
import { createRates, type Rates } from '../../../server/trip/rates';
import { createTripStore, type TripStore } from '../../../server/trip/store';
import { createTripSync, type TripSync } from '../../../server/trip/sync';
import { startFrankfurter } from '../../e2e/harness/frankfurter';
import { describeWithDocker } from '../../e2e/harness/postgres';
import { useMigratedDatabase } from '../database';
import { Connection } from './connection';

const describeDb = describeWithDocker();

// The rate provider the Trip sync's rates fetch from.
const frankfurter = await startFrankfurter();
afterAll(frankfurter.close);

function participant(name: string): Participant {
  return { id: uuidv7(), name };
}

/** A plain Expense of 24.50 EUR paid by `payer`, split evenly between `ticked`. */
function plainExpense(title: string, payer: Participant, ticked: Participant[]): Expense {
  return {
    id: uuidv7(),
    title,
    currency: 'EUR',
    time: { instant: '2026-07-14T21:30:00Z', zone: 'Europe/Zagreb' },
    mainPayerId: payer.id,
    lineItems: [
      {
        name: '',
        unitPrice: 2450,
        quantity: 1,
        split: { mode: 'even', participantIds: ticked.map(({ id }) => id) },
      },
    ],
  };
}

/** A Repayment of 12.25 EUR from `payer` to `recipient`. */
function repaymentOf(payer: Participant, recipient: Participant): Expense {
  return {
    id: uuidv7(),
    title: 'Repayment',
    currency: 'EUR',
    time: { instant: '2026-07-15T08:00:00Z', zone: 'Europe/Zagreb' },
    mainPayerId: payer.id,
    recipientId: recipient.id,
    amount: 1225,
  };
}

/** The Trip "Croatia 2026" of Kasia, Ania and Ola, with its Trip link's token. */
function croatia2026() {
  const [kasia, ania, ola] = [participant('Kasia'), participant('Ania'), participant('Ola')];
  const trip: TripWithParticipants = {
    id: uuidv7(),
    name: 'Croatia 2026',
    currency: 'EUR',
    participants: [kasia, ania, ola],
  };
  return { trip, token: randomBytes(32).toString('base64url'), kasia, ania, ola };
}

/** The browser's push subscription, as the device keeps it while notifications are on. */
const browserSubscription = {
  endpoint: 'https://push.example.com/abc',
  keys: { p256dh: 'p256dh', auth: 'auth' },
};

/**
 * Waits, with no sync asked for, until `check` passes: for a change that syncs by itself.
 * Settling a device otherwise is `sync()`, which joins the sync its last change started.
 */
async function eventually(check: () => void | Promise<void>): Promise<void> {
  await vi.waitFor(check, { timeout: 5_000, interval: 20 });
}

describeDb('the device, syncing with the real Trip sync', () => {
  const db = useMigratedDatabase();
  let sync: TripSync;
  let store: TripStore;
  let rates: Rates;

  beforeAll(() => {
    store = createTripStore(db());
    rates = createRates(db(), frankfurter.url);
    // Notifications are no part of these tests: nobody hears of the applied changes.
    sync = createTripSync(db(), store, rates, {
      async notifyAffected() {},
    });
  });

  /** A device of its own, with its own store, connected to the server. */
  function newDevice() {
    const deviceId = uuidv7();
    const deviceDb = new DeviceDb(uuidv7());
    const connection = new Connection(sync, store, rates);
    return { device: createDevice(deviceDb, connection, deviceId), deviceDb, connection, deviceId };
  }

  /**
   * Kasia's device with the Trip "Croatia 2026" created on it, and synced unless `offline`,
   * which the connection stays. Kasia is its creator, and the device's Claim. `croatia` is the
   * device's handle for the Trip.
   */
  async function setUp({ offline = false } = {}) {
    const made = croatia2026();
    const kasias = newDevice();
    kasias.connection.offline = offline;
    await kasias.device.createTrip(made.trip, made.token);
    const croatia = kasias.device.trip(made.trip.id);
    await croatia.sync();
    return { ...kasias, ...made, croatia };
  }

  /** Another device that opened the Trip from its Trip link and claimed `claim`, synced. */
  async function joined(trip: TripWithParticipants, token: string, claim: Participant) {
    const other = newDevice();
    expect(await other.device.joinTrip(trip.id, token)).toBe('joined');
    const croatia = other.device.trip(trip.id);
    await croatia.claim(claim);
    await croatia.sync();
    return { ...other, croatia };
  }

  /** The Trip as the server has it now. */
  async function onServer(trip: TripWithParticipants, token: string): Promise<ServerTrip> {
    const pulled = await sync.pull(trip.id, token);
    if (pulled === 'invalidLink' || !pulled.trip) throw new Error('The Trip link was refused');
    return pulled.trip;
  }

  /** The titles of an Expense's Revisions on the server, newest first, with their versions. */
  async function revisionsOf(trip: TripWithParticipants, expense: Expense) {
    const revisions = await store.revisions(trip.id, expense.id);
    return revisions.map(({ version, expense: { title }, deleted }) => ({
      version,
      title,
      deleted,
    }));
  }

  /**
   * Marta, a Participant of another Trip on the server: an id the server refuses in this
   * one, so an Expense paid by her is refused too.
   */
  async function martaOfAnotherTrip(): Promise<Participant> {
    const marta = participant('Marta');
    const { device } = newDevice();
    const tatry: TripWithParticipants = {
      id: uuidv7(),
      name: 'Tatry',
      currency: 'PLN',
      participants: [marta],
    };
    await device.createTrip(tatry, randomBytes(32).toString('base64url'));
    await device.trip(tatry.id).sync();
    expect((await device.read(tatry.id))?.unsynced).toBe(0);
    return marta;
  }

  /**
   * A synced Trip with a new Expense "Pizza" the server refused: its device added Marta, whose
   * id another Trip uses, and saved Pizza paid by her offline, so both went in one push.
   */
  async function rejected() {
    const set = await setUp();
    const { croatia, connection, kasia, ania } = set;
    const marta = await martaOfAnotherTrip();
    connection.offline = true;
    await croatia.addParticipant(marta);
    const pizza = plainExpense('Pizza', marta, [kasia, ania]);
    await croatia.saveExpense(pizza, null);
    await croatia.sync();
    connection.offline = false;
    await croatia.sync();
    return { ...set, pizza };
  }

  /**
   * A synced Trip whose Expense "Lidl Rovinj" Kasia's device edited to "Konzum" while Ania's
   * device made it "Spar" (version 2) first: Kasia's edit is a Conflict. The answer of the pull
   * after that push got lost, so Kasia's device hasn't pulled Ania's version.
   */
  async function inConflict() {
    const set = await setUp();
    const { device, croatia, connection, trip, token, kasia, ania } = set;
    const anias = await joined(trip, token, ania);
    const lidl = plainExpense('Lidl Rovinj', kasia, [kasia, ania]);
    await croatia.saveExpense(lidl, null);
    await croatia.sync();
    const [synced] = (await device.read(trip.id))!.local!.expenses;

    await anias.croatia.sync();
    const [seen] = (await anias.device.read(trip.id))!.local!.expenses;
    await anias.croatia.saveExpense({ ...lidl, title: 'Spar' }, seen!);
    await anias.croatia.sync();

    connection.losePullResponses = 1;
    await croatia.saveExpense({ ...lidl, title: 'Konzum' }, synced!);
    await croatia.sync();
    return { ...set, anias, lidl };
  }

  it('sends a new Trip to the server by itself', async () => {
    const { device } = newDevice();
    const { trip, token, kasia, ania, ola } = croatia2026();

    await device.createTrip(trip, token);

    await eventually(async () =>
      expect(await onServer(trip, token)).toMatchObject({
        name: 'Croatia 2026',
        participants: [kasia, ania, ola],
      }),
    );
  });

  it('sends a saved Expense, and then its deletion, to the server by itself', async () => {
    const { device, croatia, trip, kasia } = await setUp();
    const lidl = plainExpense('Lidl Rovinj', kasia, [kasia]);

    await croatia.saveExpense(lidl, null);
    await eventually(async () =>
      expect(await revisionsOf(trip, lidl)).toEqual([
        { version: 1, title: 'Lidl Rovinj', deleted: false },
      ]),
    );

    const [saved] = (await device.read(trip.id))!.local!.expenses;
    await croatia.deleteExpense(lidl, saved!);
    await eventually(async () =>
      expect((await revisionsOf(trip, lidl))[0]).toEqual({
        version: 2,
        title: 'Lidl Rovinj',
        deleted: true,
      }),
    );
  });

  it('sends Participant changes and Trip details to the server by itself', async () => {
    const { croatia, trip, token, kasia, ania, ola } = await setUp();
    const marek = participant('Marek');

    await croatia.addParticipant(marek);
    await croatia.removeParticipant(ola);
    await croatia.saveTripDetails({ name: 'Mazury', currency: 'PLN' });

    await eventually(async () =>
      expect(await onServer(trip, token)).toMatchObject({
        name: 'Mazury',
        currency: 'PLN',
        participants: [kasia, ania, marek],
        removedParticipants: [ola],
      }),
    );
  });

  it('shows a Participant renamed on another device after a pull, last write wins', async () => {
    const { device, croatia, trip, token, ania, ola } = await setUp();
    const olas = await joined(trip, token, ola);

    await olas.croatia.addParticipant({ ...ania, name: 'Anna' });
    await olas.croatia.sync();
    await croatia.addParticipant({ ...ania, name: 'Ana' });
    await croatia.sync();
    await olas.croatia.sync();

    for (const each of [device, olas.device]) {
      expect((await each.read(trip.id))?.local?.participants[1]).toEqual({ ...ania, name: 'Ana' });
    }
  });

  it('sends its version of an Expense in Conflict to the server by itself on Keep mine', async () => {
    const { croatia, trip, lidl } = await inConflict();

    await croatia.keepMine(lidl.id);

    await eventually(async () =>
      expect((await revisionsOf(trip, lidl)).map(({ title }) => title)).toEqual([
        'Konzum',
        'Spar',
        'Lidl Rovinj',
      ]),
    );
  });

  it('gives the server its push subscription by itself as notifications go on, its Claim changes and they go off', async () => {
    const { croatia, connection, trip, kasia, ania } = await setUp();

    await croatia.turnOnNotifications(browserSubscription);
    await eventually(() =>
      expect(connection.subscriptions.get(trip.id)).toEqual({
        ...browserSubscription,
        claimId: kasia.id,
      }),
    );

    await croatia.claim(ania);
    await eventually(() =>
      expect(connection.subscriptions.get(trip.id)).toEqual({
        ...browserSubscription,
        claimId: ania.id,
      }),
    );

    await croatia.turnOffNotifications();
    await eventually(() => expect(connection.subscriptions.has(trip.id)).toBe(false));
  });

  it('ends an edit started before a pull brought someone else’s version in a Conflict', async () => {
    const { device, croatia, trip, token, kasia, ania } = await setUp();
    const anias = await joined(trip, token, ania);
    const lidl = plainExpense('Lidl Rovinj', kasia, [kasia, ania]);
    await croatia.saveExpense(lidl, null);
    await croatia.sync();
    // Kasia opens Lidl Rovinj to edit it…
    const [asRead] = (await device.read(trip.id))!.local!.expenses;
    // …while Ania makes it Spar, and Kasia's device pulls that.
    await anias.croatia.sync();
    const [seen] = (await anias.device.read(trip.id))!.local!.expenses;
    await anias.croatia.saveExpense({ ...lidl, title: 'Spar' }, seen!);
    await anias.croatia.sync();
    await croatia.sync();
    expect((await device.read(trip.id))?.local?.expenses).toMatchObject([{ title: 'Spar' }]);

    await croatia.saveExpense({ ...lidl, title: 'Konzum' }, asRead!);
    await croatia.sync();

    expect((await device.read(trip.id))?.local?.expenses).toMatchObject([
      {
        title: 'Konzum',
        unsynced: { status: 'conflict', current: { title: 'Spar', version: 2 } },
      },
    ]);
    expect(await revisionsOf(trip, lidl)).toHaveLength(2);
  });

  it('pushes a Trip created offline once it is back online, in order, as its creator', async () => {
    const { device, croatia, connection, deviceId, trip, token, kasia, ania, ola } = await setUp({
      offline: true,
    });
    await croatia.saveExpense(plainExpense('Lidl Rovinj', kasia, [kasia, ania]), null);
    await croatia.sync();

    expect(await device.read(trip.id)).toMatchObject({
      local: { name: 'Croatia 2026', expenses: [{ title: 'Lidl Rovinj' }] },
      unsynced: 5,
    });

    connection.offline = false;
    await croatia.sync();

    expect((await device.read(trip.id))?.unsynced).toBe(0);
    expect(await onServer(trip, token)).toMatchObject({
      name: 'Croatia 2026',
      edited: { by: kasia.id },
      participants: [kasia, ania, ola],
      expenses: [{ title: 'Lidl Rovinj', version: 1, edited: { by: kasia.id } }],
    });
    const recorded = await db()
      .select({ claimId: changes.claimId, deviceId: changes.deviceId })
      .from(changes)
      .where(eq(changes.tripId, trip.id));
    expect(recorded).toEqual(Array(5).fill({ claimId: kasia.id, deviceId }));
  });

  it('says whether its last sync failed offline or on the server, until a sync gets through', async () => {
    const { croatia, connection, kasia } = await setUp();
    expect(croatia.lastFailure.value).toBeNull();

    connection.offline = true;
    await croatia.saveExpense(plainExpense('Lidl Rovinj', kasia, [kasia]), null);
    await croatia.sync();
    expect(croatia.lastFailure.value).toBe('offline');

    connection.offline = false;
    connection.failing = true;
    await croatia.sync();
    expect(croatia.lastFailure.value).toBe('server');

    connection.failing = false;
    await croatia.sync();
    expect(croatia.lastFailure.value).toBeNull();
  });

  it('resends a change whose answer was lost under the same id: applied once, its result reaching the device', async () => {
    const { device, croatia, connection, trip, kasia } = await setUp();
    const lidl = plainExpense('Lidl Rovinj', kasia, [kasia]);
    connection.losePushResponses = 1;
    await croatia.saveExpense(lidl, null);

    await croatia.sync();
    expect((await device.read(trip.id))?.unsynced).toBe(1);
    await croatia.sync();

    const [first, retry] = connection.pushes.slice(-2);
    expect(retry).toEqual(first);
    expect(await revisionsOf(trip, lidl)).toEqual([
      { version: 1, title: 'Lidl Rovinj', deleted: false },
    ]);
    expect(await device.read(trip.id)).toMatchObject({
      unsynced: 0,
      local: { expenses: [{ title: 'Lidl Rovinj', base: { version: 1 }, unsynced: null }] },
    });
  });

  it('sends edits of one Expense made offline one by one, each on the version the last got', async () => {
    const { device, croatia, connection, trip, kasia } = await setUp();
    connection.offline = true;
    const lidl = plainExpense('Lidl Rovinj', kasia, [kasia]);
    await croatia.saveExpense(lidl, null);
    const [saved] = (await device.read(trip.id))!.local!.expenses;
    await croatia.saveExpense({ ...lidl, title: 'Konzum' }, saved!);
    await croatia.sync();

    connection.offline = false;
    await croatia.sync();

    expect(await revisionsOf(trip, lidl)).toEqual([
      { version: 2, title: 'Konzum', deleted: false },
      { version: 1, title: 'Lidl Rovinj', deleted: false },
    ]);
    expect(connection.pushes.at(-1)?.changes).toHaveLength(1);
    expect((await device.read(trip.id))?.unsynced).toBe(0);
  });

  it('holds back only the Expense the server refuses, keeping it with why', async () => {
    const { device, croatia, connection, trip, token, kasia, pizza } = await rejected();
    await croatia.saveExpense(plainExpense('Ferry', kasia, [kasia]), null);

    await croatia.sync();
    await croatia.sync();

    const titles = connection.pushes
      .flatMap(({ changes }) => changes)
      .flatMap((change) => (change.kind === 'expense' ? [change.expense.title] : []));
    expect(titles).toEqual(['Pizza', 'Ferry']);
    expect((await onServer(trip, token)).expenses).toMatchObject([{ title: 'Ferry' }]);
    expect(await device.read(trip.id)).toMatchObject({
      unsynced: 1,
      local: {
        expenses: expect.arrayContaining([
          expect.objectContaining({
            id: pizza.id,
            unsynced: expect.objectContaining({
              status: 'rejected',
              problems: ['unknownMainPayer'],
            }),
          }),
          expect.objectContaining({ title: 'Ferry', unsynced: null }),
        ]),
      },
    });
  });

  it('sends a fix of a rejected change in its place', async () => {
    const { device, croatia, trip, token, kasia, pizza } = await rejected();
    const [shown] = (await device.read(trip.id))!.local!.expenses;

    const fixed = { ...pizza, title: 'Pizza Napoli', mainPayerId: kasia.id };
    await croatia.saveExpense(fixed, shown!);
    await croatia.sync();

    expect((await onServer(trip, token)).expenses).toMatchObject([
      { title: 'Pizza Napoli', version: 1 },
    ]);
    expect(await device.read(trip.id)).toMatchObject({
      unsynced: 0,
      local: { expenses: [{ title: 'Pizza Napoli', unsynced: null }] },
    });
  });

  it('queues only a change the server can read, with names trimmed', async () => {
    const { device, croatia, connection, trip } = await setUp();
    connection.offline = true;

    await expect(croatia.addParticipant(participant('  '))).rejects.toThrow();
    const marta = participant('  Marta ');
    await croatia.addParticipant(marta);
    await croatia.saveTripDetails({ name: ' Croatia 2027  ', currency: 'EUR' });

    expect(await device.read(trip.id)).toMatchObject({
      unsynced: 2,
      local: {
        name: 'Croatia 2027',
        participants: expect.arrayContaining([{ id: marta.id, name: 'Marta' }]),
      },
    });
  });

  it("holds an Expense change the server can't read, drops a Participant change noting it, and syncs the rest", async () => {
    const { device, deviceDb, deviceId, croatia, trip, token, kasia, ania } = await setUp();
    // Changes queued before the device checked them, e.g. kept by a store migration as they were.
    const unreadable = { id: uuidv7(), claimId: kasia.id, deviceId };
    const marta = participant('');
    const pizza = plainExpense(' ', kasia, [kasia, ania]);
    await deviceDb.outbox.bulkAdd([
      {
        tripId: trip.id,
        change: { ...unreadable, kind: 'participant', participant: marta, removed: false },
        held: null,
      },
      {
        tripId: trip.id,
        change: {
          ...unreadable,
          id: uuidv7(),
          kind: 'expense',
          base: { version: null },
          expense: pizza,
          deleted: false,
        },
        held: null,
      },
    ]);
    await croatia.saveExpense(plainExpense('Ferry', kasia, [kasia]), null);

    await croatia.sync();

    expect((await onServer(trip, token)).expenses).toMatchObject([{ title: 'Ferry' }]);
    expect(await device.read(trip.id)).toMatchObject({
      unsynced: 1,
      deviceTrip: {
        notices: [{ kind: 'changeRefused', about: { kind: 'participant', participant: marta } }],
      },
      local: {
        expenses: expect.arrayContaining([
          expect.objectContaining({
            id: pizza.id,
            unsynced: expect.objectContaining({ status: 'rejected', problems: ['malformed'] }),
          }),
        ]),
      },
    });
  });

  it('drops a rejected new Expense when its change is discarded', async () => {
    const { device, croatia, trip, pizza } = await rejected();

    await croatia.discardChanges(pizza.id);

    expect(await device.read(trip.id)).toMatchObject({ unsynced: 0, local: { expenses: [] } });
  });

  it('keeps its own changes on top of every pulled Trip', async () => {
    const { device, croatia, trip, kasia, ania } = await inConflict();

    await croatia.sync();

    const view = await device.read(trip.id);
    expect(view?.deviceTrip.snapshot?.expenses).toMatchObject([{ title: 'Spar', version: 2 }]);
    expect(view?.local?.expenses).toMatchObject([
      // Both versions say who made them: this device's by its Claim then.
      {
        title: 'Konzum',
        unsynced: { status: 'conflict', claimId: kasia.id, currentClaimId: ania.id },
      },
    ]);
  });

  it('keeps edits made during a Conflict on its own version, and keeping it sends them on the current one', async () => {
    const { device, croatia, trip, lidl } = await inConflict();
    const [shown] = (await device.read(trip.id))!.local!.expenses;
    await croatia.saveExpense({ ...lidl, title: 'Konzum Poreč' }, shown!);
    await croatia.sync();
    expect((await device.read(trip.id))?.local?.expenses).toMatchObject([
      { title: 'Konzum Poreč', unsynced: { status: 'conflict' } },
    ]);

    await croatia.keepMine(lidl.id);
    await croatia.sync();

    expect((await revisionsOf(trip, lidl)).map(({ title }) => title)).toEqual([
      'Konzum Poreč',
      'Konzum',
      'Spar',
      'Lidl Rovinj',
    ]);
    expect(await device.read(trip.id)).toMatchObject({
      unsynced: 0,
      local: { expenses: [{ title: 'Konzum Poreč', base: { version: 4 }, unsynced: null }] },
    });
  });

  it('asks again about a Conflict once a pull brings a newer version of theirs', async () => {
    const { device, croatia, anias, trip, ania, lidl } = await inConflict();
    const [seen] = (await anias.device.read(trip.id))!.local!.expenses;
    await anias.croatia.saveExpense({ ...lidl, title: 'Spar Poreč' }, seen!);
    await anias.croatia.sync();

    await croatia.sync();
    await croatia.sync();

    expect((await device.read(trip.id))?.local?.expenses).toMatchObject([
      {
        title: 'Konzum',
        unsynced: { current: { title: 'Spar Poreč', version: 3 }, currentClaimId: ania.id },
      },
    ]);
  });

  it('keeps their version by dropping its own changes, showing theirs even offline', async () => {
    const { device, croatia, connection, trip, lidl } = await inConflict();
    connection.offline = true;

    await croatia.discardChanges(lidl.id);

    expect(await device.read(trip.id)).toMatchObject({
      unsynced: 0,
      local: { expenses: [{ title: 'Spar', base: { version: 2 }, unsynced: null }] },
    });
  });

  it('deletes an Expense to Recently deleted and restores it, each change on the version the last got', async () => {
    const { device, croatia, trip, kasia } = await setUp();
    const lidl = plainExpense('Lidl Rovinj', kasia, [kasia]);
    await croatia.saveExpense(lidl, null);
    await croatia.sync();
    const [saved] = (await device.read(trip.id))!.local!.expenses;

    await croatia.deleteExpense(lidl, saved!);
    expect((await device.read(trip.id))?.local).toMatchObject({
      expenses: [],
      deletedExpenses: [{ title: 'Lidl Rovinj', deleted: true }],
    });
    const [deleted] = (await device.read(trip.id))!.local!.deletedExpenses;
    await croatia.saveExpense(toExpense(deleted!), deleted!);
    await croatia.sync();

    expect(await revisionsOf(trip, lidl)).toEqual([
      { version: 3, title: 'Lidl Rovinj', deleted: false },
      { version: 2, title: 'Lidl Rovinj', deleted: true },
      { version: 1, title: 'Lidl Rovinj', deleted: false },
    ]);
    expect((await device.read(trip.id))?.local).toMatchObject({
      expenses: [{ title: 'Lidl Rovinj', deleted: false, base: { version: 3 }, unsynced: null }],
      deletedExpenses: [],
    });
  });

  it('forgets a Trip with the changes it has not synced', async () => {
    const { device, croatia, connection, trip, token } = await setUp({ offline: true });

    await croatia.forget();
    connection.offline = false;
    await croatia.sync();

    expect(await device.readAll()).toEqual([]);
    expect(connection.pushes).toEqual([]);
    expect(await sync.pull(trip.id, token)).toBe('invalidLink');
  });

  it('removes a Participant softly, refusing while an Expense references them', async () => {
    const { device, croatia, trip, token, kasia, ania, ola } = await setUp();
    await croatia.saveExpense(plainExpense('Lidl Rovinj', kasia, [kasia, ania]), null);

    expect(await croatia.removeParticipant(ania)).toBe(1);
    expect(await croatia.removeParticipant(ola)).toBe(0);
    await croatia.sync();

    const participants = { participants: [kasia, ania], removedParticipants: [ola] };
    expect(await onServer(trip, token)).toMatchObject(participants);
    expect((await device.read(trip.id))?.local).toMatchObject(participants);
  });

  it('saves a new Trip currency while Expenses are in another, rewriting none', async () => {
    const { device, croatia, trip, token, kasia } = await setUp();
    await croatia.saveExpense(plainExpense('Ferry', kasia, [kasia]), null);

    await croatia.saveTripDetails({ name: 'Mazury', currency: 'PLN' });
    await croatia.sync();

    const details = {
      name: 'Mazury',
      currency: 'PLN',
      expenses: [{ title: 'Ferry', currency: 'EUR' }],
    };
    expect(await onServer(trip, token)).toMatchObject(details);
    expect((await device.read(trip.id))?.local).toMatchObject(details);
  });

  it("keeps the Trip currency once there's a Repayment, deleted ones aside, but takes a rename", async () => {
    const { device, croatia, trip, token, kasia, ania } = await setUp();
    const repayment = repaymentOf(ania, kasia);
    await croatia.saveExpense(repayment, null);

    expect(await croatia.saveTripDetails({ name: 'Mazury', currency: 'PLN' })).toBe(false);
    expect(await croatia.saveTripDetails({ name: 'Mazury', currency: 'EUR' })).toBe(true);
    await croatia.sync();
    expect(await onServer(trip, token)).toMatchObject({ name: 'Mazury', currency: 'EUR' });

    const recorded = (await device.read(trip.id))?.local?.expenses[0];
    await croatia.deleteExpense(repayment, recorded!);
    expect(await croatia.saveTripDetails({ name: 'Mazury', currency: 'PLN' })).toBe(true);
    await croatia.sync();
    expect(await onServer(trip, token)).toMatchObject({ currency: 'PLN' });
  });

  it('notes a new Trip currency the server refused for a Repayment recorded meanwhile, and shows the Trip currency that stands', async () => {
    const { device, croatia, connection, trip, token, kasia, ania } = await setUp();
    const anias = await joined(trip, token, ania);
    connection.offline = true;
    expect(await croatia.saveTripDetails({ name: 'Croatia 2026', currency: 'PLN' })).toBe(true);
    // A later rename carries the new Trip currency too: both are refused, told once.
    expect(await croatia.saveTripDetails({ name: 'Chorwacja', currency: 'PLN' })).toBe(true);
    await anias.croatia.saveExpense(repaymentOf(ania, kasia), null);
    await anias.croatia.sync();

    connection.offline = false;
    await croatia.sync();

    const view = await device.read(trip.id);
    expect(view?.unsynced).toBe(0);
    expect(view?.local).toMatchObject({ name: 'Croatia 2026', currency: 'EUR' });
    expect(view?.deviceTrip.notices).toMatchObject([
      { kind: 'currencyChangeRefused', currency: 'PLN' },
    ]);
    expect((await onServer(trip, token)).currency).toBe('EUR');
  });

  it('caches the rate entries every pull brings, the newest of each, also while the Trip is unchanged', async () => {
    // The Trip's day, in the evening: its rate is not published yet.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-07-14T20:00:00Z') });
    onTestFinished(() => void vi.useRealTimers());
    frankfurter.set('2026-07-13', 'HUF', 'EUR', 0.0025);
    const kasias = await setUp();
    const { trip, token, kasia, ania } = kasias;
    const langos: Expense = { ...plainExpense('Langos', kasia, [kasia]), currency: 'HUF' };
    await kasias.croatia.saveExpense(langos, null);
    await kasias.croatia.sync();
    const { device, croatia, connection } = await joined(trip, token, ania);
    // The server fills a rate in after a pull that needs it, for a later pull to bring.
    const synced = async (rates: RateEntry[]) =>
      eventually(async () => {
        await croatia.sync();
        expect((await device.read(trip.id))?.local?.rates).toEqual(rates);
      });
    const provisional: RateEntry = {
      date: '2026-07-14',
      from: 'HUF',
      to: 'EUR',
      rate: '0.0025',
      fixed: false,
    };
    await synced([provisional]);

    // Two days later the provider has published the day's own rate, which is now fixed.
    frankfurter.set('2026-07-14', 'HUF', 'EUR', 0.00251);
    vi.setSystemTime(new Date('2026-07-16T12:00:00Z'));
    const fixed: RateEntry = { ...provisional, rate: '0.00251', fixed: true };
    await synced([fixed]);

    // One no Expense needs any more stays as the latest cached rate, e.g. for a new Expense.
    frankfurter.set('2026-07-14', 'CZK', 'EUR', 0.04);
    const [saved] = (await kasias.device.read(trip.id))!.local!.expenses;
    await kasias.croatia.saveExpense({ ...langos, currency: 'CZK' }, saved!);
    await kasias.croatia.sync();
    const czk: RateEntry = { ...fixed, from: 'CZK', rate: '0.04' };
    await synced([fixed, czk]);

    // Offline, the rates it has stay.
    connection.offline = true;
    await croatia.sync();
    expect((await device.read(trip.id))?.local?.rates).toEqual([fixed, czk]);
  });

  it('keeps a rate looked up for the Expense form with the rates it has, before any Expense needs it', async () => {
    frankfurter.set('2026-07-14', 'BAM', 'EUR', 0.5113);
    const { device, croatia, connection, trip } = await setUp();
    const entry: RateEntry = {
      date: '2026-07-14',
      from: 'BAM',
      to: 'EUR',
      rate: '0.5113',
      fixed: true,
    };

    expect(await croatia.lookupRate('BAM', '2026-07-14')).toEqual({ status: 'found', entry });

    expect((await device.read(trip.id))?.local?.rates).toEqual([entry]);
    // A pull that brings no rate for it keeps it, as it does any cached rate.
    await croatia.sync();
    expect((await device.read(trip.id))?.local?.rates).toEqual([entry]);
    connection.offline = true;
    await expect(croatia.lookupRate('BAM', '2026-07-15')).rejects.toThrow(OfflineError);
  });

  it('notes the removed Participants the server brought back for its Expense, also from the answer to a retry', async () => {
    const { device, croatia, connection, trip, token, kasia, ania, ola } = await setUp();
    const anias = await joined(trip, token, ania);
    // Made offline on Kasia's device, while Ania removed Ola.
    connection.offline = true;
    const lidl = plainExpense('Lidl Rovinj', kasia, [kasia, ola]);
    await croatia.saveExpense(lidl, null);
    await croatia.sync();
    expect(await anias.croatia.removeParticipant(ola)).toBe(0);
    await anias.croatia.sync();

    connection.offline = false;
    connection.losePushResponses = 1;
    await croatia.sync();
    await croatia.sync();

    expect(await revisionsOf(trip, lidl)).toHaveLength(1);
    expect(await onServer(trip, token)).toMatchObject({
      participants: [kasia, ania, ola],
      removedParticipants: [],
    });
    expect(await device.read(trip.id)).toMatchObject({
      unsynced: 0,
      deviceTrip: {
        notices: [
          {
            id: expect.any(String),
            kind: 'participantRestored',
            participant: ola,
            expenseTitle: 'Lidl Rovinj',
          },
        ],
      },
    });
  });

  it('notes a removal the server refused, and dismisses the note', async () => {
    const { device, croatia, trip, token, ania, ola } = await setUp();
    // Ania's Expense with Ola, which Kasia's device hasn't pulled yet.
    const anias = await joined(trip, token, ania);
    const ferry = plainExpense('Ferry', ania, [ania, ola]);
    await anias.croatia.saveExpense(ferry, null);
    await anias.croatia.sync();

    expect(await croatia.removeParticipant(ola)).toBe(0);
    await croatia.sync();

    const view = await device.read(trip.id);
    expect(view?.unsynced).toBe(0);
    expect(view?.deviceTrip.notices).toMatchObject([{ kind: 'removalRefused', participant: ola }]);
    expect((await onServer(trip, token)).participants).toContainEqual(ola);

    await croatia.dismissNotice(view!.deviceTrip.notices[0]!.id);
    expect((await device.read(trip.id))?.deviceTrip.notices).toEqual([]);
  });

  it('notes a Participant and holds an Expense the server refused past the 100th, and syncs the rest', async () => {
    const made = croatia2026();
    const { token, kasia, ania, ola } = made;
    const others = Array.from({ length: PARTICIPANT_LIMIT - 3 }, (_, index) =>
      participant(`Participant ${index + 4}`),
    );
    const trip = { ...made.trip, participants: [...made.trip.participants, ...others] };
    const { device, connection } = newDevice();
    await device.createTrip(trip, token);
    const croatia = device.trip(trip.id);
    await croatia.sync();
    const anias = await joined(trip, token, ania);

    // Offline, Kasia's device ticks Ola on Pizza and adds Marta, while Ania's device removes Ola
    // and adds Basia: the Trip has 100 Participants again.
    connection.offline = true;
    const pizza = plainExpense('Pizza', kasia, [kasia, ola]);
    await croatia.saveExpense(pizza, null);
    const marta = participant('Marta');
    await croatia.addParticipant(marta);
    await croatia.saveExpense(plainExpense('Ferry', kasia, [kasia]), null);
    expect(await anias.croatia.removeParticipant(ola)).toBe(0);
    await anias.croatia.addParticipant(participant('Basia'));
    await anias.croatia.sync();
    connection.offline = false;

    await croatia.sync();

    expect((await onServer(trip, token)).expenses).toMatchObject([{ title: 'Ferry' }]);
    expect(await device.read(trip.id)).toMatchObject({
      unsynced: 1,
      deviceTrip: { notices: [{ kind: 'tooManyParticipants', participant: marta }] },
      local: {
        participants: expect.not.arrayContaining([marta]),
        expenses: expect.arrayContaining([
          expect.objectContaining({
            id: pizza.id,
            unsynced: expect.objectContaining({
              status: 'rejected',
              problems: ['tooManyParticipants'],
            }),
          }),
          expect.objectContaining({ title: 'Ferry', unsynced: null }),
        ]),
      },
    });
  });

  it('drops its Claim once a pull shows that Participant removed, noting it', async () => {
    const { device, croatia, trip, token, kasia, ania } = await setUp();
    const anias = await joined(trip, token, ania);
    await anias.croatia.removeParticipant(kasia);
    await anias.croatia.sync();

    await croatia.sync();

    expect((await device.read(trip.id))?.deviceTrip).toMatchObject({
      claim: null,
      notices: [{ kind: 'claimRemoved', participant: kasia }],
    });
  });

  it('sends its push subscription again once per run of the app, and a renewed one at once', async () => {
    const { croatia, deviceDb, connection, deviceId, trip, kasia } = await setUp();
    await croatia.turnOnNotifications(browserSubscription);
    await croatia.sync();

    // Opened again: the server may have dropped it meanwhile, as its push service said gone.
    const reopened = createDevice(deviceDb, connection, deviceId);
    await reopened.trip(trip.id).sync();
    await reopened.trip(trip.id).sync();
    expect(connection.subscribeCalls).toBe(2);

    const renewed = { ...browserSubscription, endpoint: 'https://push.example.com/renewed' };
    await reopened.renewSubscription(renewed);
    await eventually(() =>
      expect(connection.subscriptions.get(trip.id)).toEqual({ ...renewed, claimId: kasia.id }),
    );
  });

  it('removes the push subscription of a Trip forgotten offline once it is back online', async () => {
    const { device, croatia, connection, trip } = await setUp();
    await croatia.turnOnNotifications(browserSubscription);
    await croatia.sync();

    connection.offline = true;
    await croatia.forget();
    await device.syncForgotten();
    expect(connection.subscriptions.has(trip.id)).toBe(true);

    connection.offline = false;
    await device.syncForgotten();
    expect(connection.subscriptions.has(trip.id)).toBe(false);
  });
});

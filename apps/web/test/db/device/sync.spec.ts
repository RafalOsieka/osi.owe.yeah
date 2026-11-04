import 'fake-indexeddb/auto';
import { randomBytes } from 'node:crypto';
import type {
  Expense,
  Participant,
  RateEntry,
  TripSnapshot,
  TripWithParticipants,
} from '@osi/owe-yeah-domain';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, expect, it, onTestFinished, vi } from 'vitest';
import { DeviceDb } from '../../../app/sync/db';
import { createDevice } from '../../../app/sync/device';
import { toExpense } from '../../../app/sync/local-trip';
import { changes } from '../../../server/db/schema';
import { createRates } from '../../../server/trip/rates';
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

/** The browser's push subscription, as the device keeps it while notifications are on. */
const browserSubscription = {
  endpoint: 'https://push.example.com/abc',
  keys: { p256dh: 'p256dh', auth: 'auth' },
};

describeDb('the device, syncing with the real Trip sync', () => {
  const db = useMigratedDatabase();
  let sync: TripSync;
  let store: TripStore;

  beforeAll(() => {
    store = createTripStore(db());
    // Notifications are no part of these tests: nobody hears of the applied changes.
    sync = createTripSync(db(), store, createRates(db(), frankfurter.url), {
      async notifyAffected() {},
    });
  });

  /** A device of its own, with its own store, connected to the server. */
  function newDevice() {
    const deviceId = uuidv7();
    const deviceDb = new DeviceDb(uuidv7());
    const connection = new Connection(sync, store);
    return { device: createDevice(deviceDb, connection, deviceId), deviceDb, connection, deviceId };
  }

  /**
   * Kasia's device with the Trip "Croatia 2026" of Kasia, Ania and Ola just created on it,
   * not synced yet. Kasia is its creator, and the device's Claim.
   */
  async function setUp() {
    const [kasia, ania, ola] = [participant('Kasia'), participant('Ania'), participant('Ola')];
    const trip: TripWithParticipants = {
      id: uuidv7(),
      name: 'Croatia 2026',
      currency: 'EUR',
      participants: [kasia, ania, ola],
    };
    const token = randomBytes(32).toString('base64url');
    const kasias = newDevice();
    await kasias.device.createTrip(trip, token);
    return { ...kasias, trip, token, kasia, ania, ola };
  }

  /** Another device that opened the Trip from its Trip link and claimed `claim`. */
  async function joined(trip: TripWithParticipants, token: string, claim: Participant) {
    const other = newDevice();
    expect(await other.device.joinTrip(trip.id, token)).toBe('joined');
    await other.device.claim(trip.id, claim);
    return other;
  }

  /** The Trip as the server has it now. */
  async function onServer(trip: TripWithParticipants, token: string): Promise<TripSnapshot> {
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
    await device.sync(tatry.id);
    expect((await device.read(tatry.id))?.unsynced).toBe(0);
    return marta;
  }

  /**
   * A synced Trip with a new Expense "Pizza" the server refused: its device added Marta, whose
   * id another Trip uses, and saved Pizza paid by her, in one push.
   */
  async function rejected() {
    const set = await setUp();
    const { device, trip, kasia, ania } = set;
    await device.sync(trip.id);
    const marta = await martaOfAnotherTrip();
    await device.addParticipant(trip.id, marta);
    const pizza = plainExpense('Pizza', marta, [kasia, ania]);
    await device.saveExpense(trip.id, pizza, { version: null });
    await device.sync(trip.id);
    return { ...set, pizza };
  }

  /**
   * A synced Trip whose Expense "Lidl Rovinj" Kasia's device edited to "Konzum" while Ania's
   * device made it "Spar" (version 2) first: Kasia's edit is a Conflict. The answer of the pull
   * after that push got lost, so Kasia's device hasn't pulled Ania's version.
   */
  async function inConflict() {
    const set = await setUp();
    const { device, trip, token, kasia, ania } = set;
    await device.sync(trip.id);
    const anias = await joined(trip, token, ania);
    const lidl = plainExpense('Lidl Rovinj', kasia, [kasia, ania]);
    await device.saveExpense(trip.id, lidl, { version: null });
    await device.sync(trip.id);
    const [synced] = (await device.read(trip.id))!.local!.expenses;

    await anias.device.sync(trip.id);
    const [seen] = (await anias.device.read(trip.id))!.local!.expenses;
    await anias.device.saveExpense(trip.id, { ...lidl, title: 'Spar' }, seen!.base);
    await anias.device.sync(trip.id);

    await device.saveExpense(trip.id, { ...lidl, title: 'Konzum' }, synced!.base);
    set.connection.losePullResponses = 1;
    await device.sync(trip.id);
    return { ...set, anias, lidl };
  }

  it('pushes a Trip created offline on its first sync, in order, as its creator', async () => {
    const { device, connection, deviceId, trip, token, kasia, ania, ola } = await setUp();
    connection.offline = true;
    await device.saveExpense(trip.id, plainExpense('Lidl Rovinj', kasia, [kasia, ania]), {
      version: null,
    });
    await device.sync(trip.id);

    expect(await device.read(trip.id)).toMatchObject({
      local: { name: 'Croatia 2026', expenses: [{ title: 'Lidl Rovinj' }] },
      unsynced: 5,
    });

    connection.offline = false;
    await device.sync(trip.id);

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

  it('resends a change whose answer was lost under the same id: applied once, its result reaching the device', async () => {
    const { device, connection, trip, kasia } = await setUp();
    await device.sync(trip.id);
    const lidl = plainExpense('Lidl Rovinj', kasia, [kasia]);
    await device.saveExpense(trip.id, lidl, { version: null });
    connection.losePushResponses = 1;

    await device.sync(trip.id);
    expect((await device.read(trip.id))?.unsynced).toBe(1);
    await device.sync(trip.id);

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
    const { device, connection, trip, kasia } = await setUp();
    await device.sync(trip.id);
    connection.offline = true;
    const lidl = plainExpense('Lidl Rovinj', kasia, [kasia]);
    await device.saveExpense(trip.id, lidl, { version: null });
    const [saved] = (await device.read(trip.id))!.local!.expenses;
    await device.saveExpense(trip.id, { ...lidl, title: 'Konzum' }, saved!.base);

    connection.offline = false;
    await device.sync(trip.id);

    expect(await revisionsOf(trip, lidl)).toEqual([
      { version: 2, title: 'Konzum', deleted: false },
      { version: 1, title: 'Lidl Rovinj', deleted: false },
    ]);
    expect(connection.pushes.at(-1)?.changes).toHaveLength(1);
    expect((await device.read(trip.id))?.unsynced).toBe(0);
  });

  it('holds back only the Expense the server refuses, keeping it with why', async () => {
    const { device, connection, trip, token, kasia, pizza } = await rejected();
    await device.saveExpense(trip.id, plainExpense('Ferry', kasia, [kasia]), { version: null });

    await device.sync(trip.id);
    await device.sync(trip.id);

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
    const { device, trip, token, kasia, pizza } = await rejected();
    const [shown] = (await device.read(trip.id))!.local!.expenses;

    const fixed = { ...pizza, title: 'Pizza Napoli', mainPayerId: kasia.id };
    await device.saveExpense(trip.id, fixed, shown!.base);
    await device.sync(trip.id);

    expect((await onServer(trip, token)).expenses).toMatchObject([
      { title: 'Pizza Napoli', version: 1 },
    ]);
    expect(await device.read(trip.id)).toMatchObject({
      unsynced: 0,
      local: { expenses: [{ title: 'Pizza Napoli', unsynced: null }] },
    });
  });

  it('drops a rejected new Expense when its change is discarded', async () => {
    const { device, trip, pizza } = await rejected();

    await device.discardChanges(trip.id, pizza.id);

    expect(await device.read(trip.id)).toMatchObject({ unsynced: 0, local: { expenses: [] } });
  });

  it('keeps its own changes on top of every pulled Trip', async () => {
    const { device, trip, kasia, ania } = await inConflict();

    await device.sync(trip.id);

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
    const { device, trip, lidl } = await inConflict();
    const [shown] = (await device.read(trip.id))!.local!.expenses;
    await device.saveExpense(trip.id, { ...lidl, title: 'Konzum Poreč' }, shown!.base);
    await device.sync(trip.id);
    expect((await device.read(trip.id))?.local?.expenses).toMatchObject([
      { title: 'Konzum Poreč', unsynced: { status: 'conflict' } },
    ]);

    await device.keepMine(trip.id, lidl.id);
    await device.sync(trip.id);

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
    const { device, anias, trip, ania, lidl } = await inConflict();
    const [seen] = (await anias.device.read(trip.id))!.local!.expenses;
    await anias.device.saveExpense(trip.id, { ...lidl, title: 'Spar Poreč' }, seen!.base);
    await anias.device.sync(trip.id);

    await device.sync(trip.id);
    await device.sync(trip.id);

    expect((await device.read(trip.id))?.local?.expenses).toMatchObject([
      {
        title: 'Konzum',
        unsynced: { current: { title: 'Spar Poreč', version: 3 }, currentClaimId: ania.id },
      },
    ]);
  });

  it('keeps their version by dropping its own changes, showing theirs even offline', async () => {
    const { device, connection, trip, lidl } = await inConflict();
    connection.offline = true;

    await device.discardChanges(trip.id, lidl.id);

    expect(await device.read(trip.id)).toMatchObject({
      unsynced: 0,
      local: { expenses: [{ title: 'Spar', base: { version: 2 }, unsynced: null }] },
    });
  });

  it('deletes an Expense to Recently deleted and restores it, each change on the version the last got', async () => {
    const { device, trip, kasia } = await setUp();
    const lidl = plainExpense('Lidl Rovinj', kasia, [kasia]);
    await device.saveExpense(trip.id, lidl, { version: null });
    await device.sync(trip.id);
    const [saved] = (await device.read(trip.id))!.local!.expenses;

    await device.deleteExpense(trip.id, lidl, saved!.base);
    expect((await device.read(trip.id))?.local).toMatchObject({
      expenses: [],
      deletedExpenses: [{ title: 'Lidl Rovinj', deleted: true }],
    });
    const [deleted] = (await device.read(trip.id))!.local!.deletedExpenses;
    await device.saveExpense(trip.id, toExpense(deleted!), deleted!.base);
    await device.sync(trip.id);

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
    const { device, connection, trip, token } = await setUp();
    connection.offline = true;

    await device.forgetTrip(trip.id);
    connection.offline = false;
    await device.sync(trip.id);

    expect(await device.readAll()).toEqual([]);
    expect(connection.pushes).toEqual([]);
    expect(await sync.pull(trip.id, token)).toBe('invalidLink');
  });

  it('removes a Participant softly, refusing while an Expense references them', async () => {
    const { device, trip, token, kasia, ania, ola } = await setUp();
    await device.saveExpense(trip.id, plainExpense('Lidl Rovinj', kasia, [kasia, ania]), {
      version: null,
    });

    expect(await device.removeParticipant(trip.id, ania)).toBe(1);
    expect(await device.removeParticipant(trip.id, ola)).toBe(0);
    await device.sync(trip.id);

    const participants = { participants: [kasia, ania], removedParticipants: [ola] };
    expect(await onServer(trip, token)).toMatchObject(participants);
    expect((await device.read(trip.id))?.local).toMatchObject(participants);
  });

  it('saves a new Trip currency while Expenses are in another, rewriting none', async () => {
    const { device, trip, token, kasia } = await setUp();
    await device.saveExpense(trip.id, plainExpense('Ferry', kasia, [kasia]), { version: null });

    await device.saveTripDetails(trip.id, { name: 'Mazury', currency: 'PLN' });
    await device.sync(trip.id);

    const details = {
      name: 'Mazury',
      currency: 'PLN',
      expenses: [{ title: 'Ferry', currency: 'EUR' }],
    };
    expect(await onServer(trip, token)).toMatchObject(details);
    expect((await device.read(trip.id))?.local).toMatchObject(details);
  });

  it('caches the rate entries every pull brings, the newest of each, also while the Trip is unchanged', async () => {
    // The Trip's day, in the evening: its rate is not published yet.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-07-14T20:00:00Z') });
    onTestFinished(() => void vi.useRealTimers());
    frankfurter.set('2026-07-13', 'HUF', 'EUR', 0.0025);
    const { device: kasias, trip, token, kasia, ania } = await setUp();
    const langos: Expense = { ...plainExpense('Langos', kasia, [kasia]), currency: 'HUF' };
    await kasias.saveExpense(trip.id, langos, { version: null });
    await kasias.sync(trip.id);
    const { device, connection } = await joined(trip, token, ania);
    const provisional: RateEntry = {
      date: '2026-07-14',
      from: 'HUF',
      to: 'EUR',
      rate: '0.0025',
      fixed: false,
    };
    expect((await device.read(trip.id))?.local?.rates).toEqual([provisional]);

    // Two days later the provider has published the day's own rate, which is now fixed.
    frankfurter.set('2026-07-14', 'HUF', 'EUR', 0.00251);
    vi.setSystemTime(new Date('2026-07-16T12:00:00Z'));
    await device.sync(trip.id);
    const fixed: RateEntry = { ...provisional, rate: '0.00251', fixed: true };
    expect((await device.read(trip.id))?.local?.rates).toEqual([fixed]);

    // One no Expense needs any more stays as the latest cached rate, e.g. for a new Expense.
    frankfurter.set('2026-07-14', 'CZK', 'EUR', 0.04);
    const [saved] = (await kasias.read(trip.id))!.local!.expenses;
    await kasias.saveExpense(trip.id, { ...langos, currency: 'CZK' }, saved!.base);
    await kasias.sync(trip.id);
    await device.sync(trip.id);
    const czk: RateEntry = { ...fixed, from: 'CZK', rate: '0.04' };
    expect((await device.read(trip.id))?.local?.rates).toEqual([fixed, czk]);

    // Offline, the rates it has stay.
    connection.offline = true;
    await device.sync(trip.id);
    expect((await device.read(trip.id))?.local?.rates).toEqual([fixed, czk]);
  });

  it('notes the removed Participants the server brought back for its Expense, also from the answer to a retry', async () => {
    const { device, connection, trip, token, kasia, ania, ola } = await setUp();
    await device.sync(trip.id);
    const anias = await joined(trip, token, ania);
    // Made offline on Kasia's device, while Ania removed Ola.
    connection.offline = true;
    const lidl = plainExpense('Lidl Rovinj', kasia, [kasia, ola]);
    await device.saveExpense(trip.id, lidl, { version: null });
    expect(await anias.device.removeParticipant(trip.id, ola)).toBe(0);
    await anias.device.sync(trip.id);

    connection.offline = false;
    connection.losePushResponses = 1;
    await device.sync(trip.id);
    await device.sync(trip.id);

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
    const { device, trip, token, ania, ola } = await setUp();
    await device.sync(trip.id);
    // Ania's Expense with Ola, which Kasia's device hasn't pulled yet.
    const anias = await joined(trip, token, ania);
    const ferry = plainExpense('Ferry', ania, [ania, ola]);
    await anias.device.saveExpense(trip.id, ferry, { version: null });
    await anias.device.sync(trip.id);

    expect(await device.removeParticipant(trip.id, ola)).toBe(0);
    await device.sync(trip.id);

    const view = await device.read(trip.id);
    expect(view?.unsynced).toBe(0);
    expect(view?.deviceTrip.notices).toMatchObject([{ kind: 'removalRefused', participant: ola }]);
    expect((await onServer(trip, token)).participants).toContainEqual(ola);

    await device.dismissNotice(trip.id, view!.deviceTrip.notices[0]!.id);
    expect((await device.read(trip.id))?.deviceTrip.notices).toEqual([]);
  });

  it('drops its Claim once a pull shows that Participant removed, noting it', async () => {
    const { device, trip, token, kasia, ania } = await setUp();
    await device.sync(trip.id);
    const anias = await joined(trip, token, ania);
    await anias.device.removeParticipant(trip.id, kasia);
    await anias.device.sync(trip.id);

    await device.sync(trip.id);

    expect((await device.read(trip.id))?.deviceTrip).toMatchObject({
      claim: null,
      notices: [{ kind: 'claimRemoved', participant: kasia }],
    });
  });

  it('registers its push subscription on sync while notifications are on, following its Claim', async () => {
    const { device, connection, trip, kasia, ania } = await setUp();
    await device.turnOnNotifications(trip.id, browserSubscription);

    await device.sync(trip.id);
    expect(connection.subscriptions.get(trip.id)).toEqual({
      ...browserSubscription,
      claimId: kasia.id,
    });

    await device.claim(trip.id, ania);
    await device.sync(trip.id);
    await device.sync(trip.id);
    expect(connection.subscriptions.get(trip.id)).toEqual({
      ...browserSubscription,
      claimId: ania.id,
    });
    // Sent once per Claim: an unchanged subscription is not sent again.
    expect(connection.subscribeCalls).toBe(2);
  });

  it('sends its push subscription again once per run of the app, and a renewed one at once', async () => {
    const { device, deviceDb, connection, deviceId, trip, kasia } = await setUp();
    await device.turnOnNotifications(trip.id, browserSubscription);
    await device.sync(trip.id);

    // Opened again: the server may have dropped it meanwhile, as its push service said gone.
    const reopened = createDevice(deviceDb, connection, deviceId);
    await reopened.sync(trip.id);
    await reopened.sync(trip.id);
    expect(connection.subscribeCalls).toBe(2);

    const renewed = { ...browserSubscription, endpoint: 'https://push.example.com/renewed' };
    await reopened.renewSubscription(renewed);
    await reopened.sync(trip.id);
    expect(connection.subscriptions.get(trip.id)).toEqual({ ...renewed, claimId: kasia.id });
  });

  it('removes its push subscription once notifications are off, after being offline', async () => {
    const { device, connection, trip } = await setUp();
    await device.turnOnNotifications(trip.id, browserSubscription);
    await device.sync(trip.id);

    connection.offline = true;
    await device.turnOffNotifications(trip.id);
    await device.sync(trip.id);
    expect(connection.subscriptions.has(trip.id)).toBe(true);

    connection.offline = false;
    await device.sync(trip.id);
    expect(connection.subscriptions.has(trip.id)).toBe(false);
  });

  it('removes the push subscription of a Trip forgotten offline once it is back online', async () => {
    const { device, connection, trip } = await setUp();
    await device.turnOnNotifications(trip.id, browserSubscription);
    await device.sync(trip.id);

    connection.offline = true;
    await device.forgetTrip(trip.id);
    await device.syncForgotten();
    expect(connection.subscriptions.has(trip.id)).toBe(true);

    connection.offline = false;
    await device.syncForgotten();
    expect(connection.subscriptions.has(trip.id)).toBe(false);
  });
});

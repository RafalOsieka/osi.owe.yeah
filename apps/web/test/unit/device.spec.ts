import 'fake-indexeddb/auto';
import type {
  ChangeResult,
  Expense,
  PullResponse,
  PushRequest,
  PushResponse,
  RateEntry,
  ReminderStatus,
  Revision,
  StoredExpense,
  SubscriptionRequest,
  SyncChange,
  TripSnapshot,
  TripWithParticipants,
} from '@osi/owe-yeah-domain';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it } from 'vitest';
import { DeviceDb } from '../../app/sync/db';
import { createDevice, type Reminded, type Transport } from '../../app/sync/device';
import { toExpense } from '../../app/sync/local-trip';

const deviceId = '0b6e8f3a-2c1d-4e5f-8a9b-1c2d3e4f5a6b';
const token = 'x'.repeat(43);
const kasia = { id: uuidv7(), name: 'Kasia' };
const ania = { id: uuidv7(), name: 'Ania' };
const ola = { id: uuidv7(), name: 'Ola' };

/** Accepts every change, an Expense at its base version + 1. */
const acceptAll = (change: SyncChange): ChangeResult => ({
  changeId: change.id,
  status: 'accepted',
  version: change.kind === 'expense' ? (change.baseVersion ?? 0) + 1 : null,
});

/**
 * A stand-in for the server: records every push, answers each change with `answer`
 * (accepting by default, an Expense at its base version + 1), and pulls `snapshot`. While
 * `offline` nothing gets through; `loseResponses` lets pushes land but drops the answers.
 */
class FakeServer implements Transport {
  pushes: PushRequest[] = [];
  offline = false;
  loseResponses = 0;
  snapshot: TripSnapshot | null = null;
  rates: RateEntry[] = [];
  answer = acceptAll;

  async push(_tripId: string, _token: string, request: PushRequest): Promise<PushResponse> {
    if (this.offline) throw new Error('offline');
    this.pushes.push(request);
    const results = request.changes.map((change) => this.answer(change));
    if (this.loseResponses-- > 0) throw new Error('response lost');
    return { results };
  }

  async pull(_tripId: string, _token: string, since?: number): Promise<PullResponse> {
    if (this.offline) throw new Error('offline');
    const { snapshot } = this;
    return { trip: snapshot && snapshot.version !== since ? snapshot : null, rates: this.rates };
  }

  async revisions(): Promise<Revision[]> {
    return [];
  }

  async reminderStatus(): Promise<ReminderStatus> {
    return { reachable: [], remindedToday: [] };
  }

  async remind(): Promise<Reminded> {
    return 'sent';
  }

  /** The device's push subscription to each Trip, as the server has it. */
  subscriptions = new Map<string, SubscriptionRequest>();
  subscribeCalls = 0;

  async subscribe(tripId: string, _token: string, _deviceId: string, request: SubscriptionRequest) {
    if (this.offline) throw new Error('offline');
    this.subscribeCalls++;
    this.subscriptions.set(tripId, request);
  }

  async unsubscribe(tripId: string) {
    if (this.offline) throw new Error('offline');
    this.subscriptions.delete(tripId);
  }

  /** The changes of every push, in the order they were sent. */
  sent(): SyncChange[] {
    return this.pushes.flatMap(({ changes }) => changes);
  }
}

function setUp() {
  const server = new FakeServer();
  const device = createDevice(new DeviceDb(uuidv7()), server, deviceId);
  return { server, device };
}

/** A synced Trip with a new Expense "Pizza" the server rejected. */
async function rejected() {
  const { server, device } = setUp();
  await device.createTrip(trip, token);
  await device.sync(trip.id);
  const pizza = plainExpense('Pizza');
  server.answer = (change) => ({
    changeId: change.id,
    status: 'rejected',
    problems: ['unknownMainPayer'],
  });
  await device.saveExpense(trip.id, pizza, { version: null });
  await device.sync(trip.id);
  return { server, device, pizza };
}

/**
 * A synced Trip whose Expense "Lidl Rovinj" this device edited to "Konzum" while Ania made
 * it "Spar" (version 2) first: the device's edit is a Conflict. The device hasn't pulled
 * Ania's version.
 */
async function inConflict() {
  const { server, device } = setUp();
  await device.createTrip(trip, token);
  await device.sync(trip.id);
  const lidl = plainExpense('Lidl Rovinj');
  await device.saveExpense(trip.id, lidl, { version: null });
  await device.sync(trip.id);
  const [synced] = (await device.read(trip.id))!.local!.expenses;
  server.answer = (change) => ({
    changeId: change.id,
    status: 'conflict',
    current: stored({ ...lidl, title: 'Spar' }, 2),
    currentClaimId: ania.id,
  });
  await device.saveExpense(trip.id, { ...lidl, title: 'Konzum' }, synced!.base);
  await device.sync(trip.id);
  return { server, device, lidl };
}

const trip: TripWithParticipants = {
  id: uuidv7(),
  name: 'Croatia 2026',
  currency: 'EUR',
  participants: [kasia, ania],
};

/** The Trip as the server pulls it, without its version and Expenses. */
const pulledTrip = { ...trip, edited: null, removedParticipants: [] };

/** `expense` as the server has it at `version`, live. */
function stored(expense: Expense, version: number): StoredExpense {
  return { ...expense, version, deleted: false, edited: null };
}

/** The browser's push subscription, as the device keeps it while notifications are on. */
const browserSubscription = {
  endpoint: 'https://push.example.com/abc',
  keys: { p256dh: 'p256dh', auth: 'auth' },
};

function plainExpense(title: string, id = uuidv7()): Expense {
  return {
    id,
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
  it('pushes a Trip created offline on its first sync, in order, as its creator', async () => {
    const { server, device } = setUp();
    server.offline = true;
    await device.createTrip(trip, token);
    await device.saveExpense(trip.id, plainExpense('Lidl Rovinj'), { version: null });
    await device.sync(trip.id);

    expect(await device.read(trip.id)).toMatchObject({
      local: { name: 'Croatia 2026', expenses: [{ title: 'Lidl Rovinj' }] },
      unsynced: 4,
    });

    server.offline = false;
    await device.sync(trip.id);

    expect(server.sent().map(({ kind }) => kind)).toEqual([
      'trip',
      'participant',
      'participant',
      'expense',
    ]);
    expect(server.sent().every((change) => change.claimId === kasia.id)).toBe(true);
    expect(server.sent().every((change) => change.deviceId === deviceId)).toBe(true);
    expect((await device.read(trip.id))?.unsynced).toBe(0);
  });

  it('resends a change whose answer was lost under the same id', async () => {
    const { server, device } = setUp();
    await device.createTrip(trip, token);
    await device.sync(trip.id);
    server.loseResponses = 1;
    await device.saveExpense(trip.id, plainExpense('Lidl Rovinj'), { version: null });

    await device.sync(trip.id);
    await device.sync(trip.id);

    const [first, retry] = server.pushes.slice(-2).map(({ changes }) => changes);
    expect(retry).toEqual(first);
    expect((await device.read(trip.id))?.unsynced).toBe(0);
  });

  it('sends edits of one Expense made offline one by one, each on the version the last got', async () => {
    const { server, device } = setUp();
    await device.createTrip(trip, token);
    await device.sync(trip.id);
    server.offline = true;
    const lidl = plainExpense('Lidl Rovinj');
    await device.saveExpense(trip.id, lidl, { version: null });
    const [saved] = (await device.read(trip.id))!.local!.expenses;
    await device.saveExpense(trip.id, { ...lidl, title: 'Konzum' }, saved!.base);

    server.offline = false;
    await device.sync(trip.id);

    const expenseChanges = server.sent().filter((change) => change.kind === 'expense');
    expect(expenseChanges).toMatchObject([
      { baseVersion: null, expense: { title: 'Lidl Rovinj' } },
      { baseVersion: 1, expense: { title: 'Konzum' } },
    ]);
    expect(server.pushes.at(-1)?.changes).toHaveLength(1);
  });

  it('holds back only the Expense the server refuses, keeping it with why', async () => {
    const { server, device } = setUp();
    await device.createTrip(trip, token);
    await device.sync(trip.id);
    const refused = plainExpense('Pizza');
    server.answer = (change) =>
      change.kind === 'expense' && change.expense.id === refused.id
        ? { changeId: change.id, status: 'rejected', problems: ['unknownMainPayer'] }
        : { changeId: change.id, status: 'accepted', version: 1 };
    await device.saveExpense(trip.id, refused, { version: null });
    await device.saveExpense(trip.id, plainExpense('Ferry'), { version: null });

    await device.sync(trip.id);
    await device.sync(trip.id);

    const titles = server
      .sent()
      .flatMap((change) => (change.kind === 'expense' ? [change.expense.title] : []));
    expect(titles).toEqual(['Pizza', 'Ferry']);
    expect(await device.read(trip.id)).toMatchObject({
      unsynced: 1,
      local: {
        expenses: expect.arrayContaining([
          expect.objectContaining({
            title: 'Pizza',
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

  it('keeps its own changes on top of every pulled Trip', async () => {
    const { server, device, lidl } = await inConflict();
    server.snapshot = {
      ...pulledTrip,
      version: 9,
      expenses: [stored({ ...lidl, title: 'Spar' }, 2)],
    };

    await device.sync(trip.id);

    expect((await device.read(trip.id))?.local?.expenses).toMatchObject([
      // Both versions say who made them: this device's by its Claim then.
      {
        title: 'Konzum',
        unsynced: { status: 'conflict', claimId: kasia.id, currentClaimId: ania.id },
      },
    ]);
  });

  it('keeps edits made during a Conflict on its own version, and keeping it sends them on the current one', async () => {
    const { server, device, lidl } = await inConflict();
    const [shown] = (await device.read(trip.id))!.local!.expenses;
    await device.saveExpense(trip.id, { ...lidl, title: 'Konzum Poreč' }, shown!.base);
    await device.sync(trip.id);
    expect((await device.read(trip.id))?.local?.expenses).toMatchObject([
      { title: 'Konzum Poreč', unsynced: { status: 'conflict' } },
    ]);

    server.answer = acceptAll;
    await device.keepMine(trip.id, lidl.id);
    await device.sync(trip.id);

    expect(server.sent().slice(-2)).toMatchObject([
      { baseVersion: 2, expense: { title: 'Konzum' } },
      { baseVersion: 3, expense: { title: 'Konzum Poreč' } },
    ]);
    expect(await device.read(trip.id)).toMatchObject({
      unsynced: 0,
      local: { expenses: [{ title: 'Konzum Poreč', unsynced: null }] },
    });
  });

  it('sends a fix of a rejected change in its place', async () => {
    const { server, device, pizza } = await rejected();
    const [shown] = (await device.read(trip.id))!.local!.expenses;
    server.answer = acceptAll;

    await device.saveExpense(trip.id, { ...pizza, title: 'Pizza Napoli' }, shown!.base);
    await device.sync(trip.id);

    expect(server.sent().at(-1)).toMatchObject({
      baseVersion: null,
      expense: { title: 'Pizza Napoli' },
    });
    expect(await device.read(trip.id)).toMatchObject({
      unsynced: 0,
      local: { expenses: [{ title: 'Pizza Napoli', unsynced: null }] },
    });
  });

  it('drops a rejected new Expense when its change is discarded', async () => {
    const { device, pizza } = await rejected();

    await device.discardChanges(trip.id, pizza.id);

    expect(await device.read(trip.id)).toMatchObject({ unsynced: 0, local: { expenses: [] } });
  });

  it('asks again about a Conflict once a pull brings a newer version of theirs', async () => {
    const { server, device, lidl } = await inConflict();
    const newer = stored({ ...lidl, title: 'Spar Poreč' }, 3);
    server.snapshot = { ...pulledTrip, version: 9, expenses: [newer] };
    server.answer = (change) => ({
      changeId: change.id,
      status: 'conflict',
      current: newer,
      currentClaimId: kasia.id,
    });

    await device.sync(trip.id);
    await device.sync(trip.id);

    expect((await device.read(trip.id))?.local?.expenses).toMatchObject([
      { title: 'Konzum', unsynced: { current: { title: 'Spar Poreč' }, currentClaimId: kasia.id } },
    ]);
  });

  it('keeps their version by dropping its own changes, showing theirs even offline', async () => {
    const { server, device, lidl } = await inConflict();
    server.offline = true;

    await device.discardChanges(trip.id, lidl.id);

    expect(await device.read(trip.id)).toMatchObject({
      unsynced: 0,
      local: { expenses: [{ title: 'Spar', base: { version: 2 }, unsynced: null }] },
    });
  });

  it('deletes an Expense to Recently deleted and restores it, each change on the version the last got', async () => {
    const { server, device } = setUp();
    await device.createTrip(trip, token);
    const lidl = plainExpense('Lidl Rovinj');
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

    expect(server.sent().filter((change) => change.kind === 'expense')).toEqual([
      expect.objectContaining({ baseVersion: null, deleted: false }),
      expect.objectContaining({ baseVersion: 1, deleted: true, expense: lidl }),
      expect.objectContaining({ baseVersion: 2, deleted: false, expense: lidl }),
    ]);
    expect((await device.read(trip.id))?.local).toMatchObject({
      expenses: [{ title: 'Lidl Rovinj', deleted: false, base: { version: 3 }, unsynced: null }],
      deletedExpenses: [],
    });
  });

  it('refuses an Expense that breaks a Trip rule before queueing it', async () => {
    const { device } = setUp();
    await device.createTrip(trip, token);

    const problems = await device.saveExpense(
      trip.id,
      { ...plainExpense('Pizza'), mainPayerId: uuidv7() },
      { version: null },
    );

    expect(problems).toEqual(['unknownMainPayer']);
    expect((await device.read(trip.id))?.local?.expenses).toEqual([]);
  });

  it('forgets a Trip with the changes it has not synced', async () => {
    const { server, device } = setUp();
    server.offline = true;
    await device.createTrip(trip, token);

    await device.forgetTrip(trip.id);
    server.offline = false;
    await device.sync(trip.id);

    expect(await device.readAll()).toEqual([]);
    expect(server.pushes).toEqual([]);
  });

  it('removes a Participant softly, refusing while an Expense references them', async () => {
    const { server, device } = setUp();
    await device.createTrip({ ...trip, participants: [kasia, ania, ola] }, token);
    await device.saveExpense(trip.id, plainExpense('Lidl Rovinj'), { version: null });

    expect(await device.removeParticipant(trip.id, ania)).toBe(1);
    expect(await device.removeParticipant(trip.id, ola)).toBe(0);
    await device.sync(trip.id);

    expect(server.sent().at(-1)).toMatchObject({ participant: ola, removed: true });
    expect((await device.read(trip.id))?.local).toMatchObject({
      participants: [kasia, ania],
      removedParticipants: [ola],
    });
  });

  it('saves a new Trip currency while Expenses are in another, rewriting none', async () => {
    const { server, device } = setUp();
    await device.createTrip(trip, token);
    await device.saveExpense(trip.id, plainExpense('Ferry'), { version: null });

    await device.saveTripDetails(trip.id, { name: 'Mazury', currency: 'PLN' });
    await device.sync(trip.id);

    expect(server.sent().filter(({ kind }) => kind === 'expense')).toHaveLength(1);
    expect((await device.read(trip.id))?.local).toMatchObject({
      name: 'Mazury',
      currency: 'PLN',
      expenses: [{ title: 'Ferry', currency: 'EUR' }],
    });
  });

  it('caches the rate entries every pull brings, the newest of each, also while the Trip is unchanged', async () => {
    const { server, device } = setUp();
    server.snapshot = { ...pulledTrip, version: 1, expenses: [] };
    await device.joinTrip(trip.id, token);
    const provisional: RateEntry = {
      date: '2026-07-14',
      from: 'HUF',
      to: 'EUR',
      rate: '0.0025',
      fixed: false,
    };
    server.rates = [provisional];
    await device.sync(trip.id);
    expect((await device.read(trip.id))?.local?.rates).toEqual([provisional]);

    const fixed: RateEntry = { ...provisional, rate: '0.00251', fixed: true };
    server.rates = [fixed];
    await device.sync(trip.id);
    expect((await device.read(trip.id))?.local?.rates).toEqual([fixed]);

    // One no Expense needs any more stays as the latest cached rate, e.g. for a new Expense.
    const later: RateEntry = { ...provisional, date: '2026-07-15', from: 'CZK', rate: '0.04' };
    server.rates = [later];
    await device.sync(trip.id);
    expect((await device.read(trip.id))?.local?.rates).toEqual([fixed, later]);

    // Offline, the rates it has stay.
    server.offline = true;
    await device.sync(trip.id);
    expect((await device.read(trip.id))?.local?.rates).toEqual([fixed, later]);
  });

  it('remembers the currency of the Expense it saved last in the Trip', async () => {
    const { device } = setUp();
    await device.createTrip(trip, token);
    expect((await device.read(trip.id))?.deviceTrip.lastCurrency).toBe(null);

    await device.saveExpense(
      trip.id,
      { ...plainExpense('Langos'), currency: 'HUF' },
      {
        version: null,
      },
    );

    expect((await device.read(trip.id))?.deviceTrip.lastCurrency).toBe('HUF');
  });

  it('notes the removed Participants the server brought back for its Expense', async () => {
    const { server, device } = setUp();
    await device.createTrip(trip, token);
    await device.sync(trip.id);
    server.answer = (change) =>
      change.kind === 'expense'
        ? { changeId: change.id, status: 'accepted', version: 1, restored: [ania.id] }
        : acceptAll(change);

    await device.saveExpense(trip.id, plainExpense('Lidl Rovinj'), { version: null });
    await device.sync(trip.id);

    expect((await device.read(trip.id))?.deviceTrip.notices).toEqual([
      {
        id: expect.any(String),
        kind: 'participantRestored',
        participant: ania,
        expenseTitle: 'Lidl Rovinj',
      },
    ]);
  });

  it('notes a removal the server refused, and dismisses the note', async () => {
    const { server, device } = setUp();
    await device.createTrip(trip, token);
    await device.sync(trip.id);
    server.answer = (change) => ({
      changeId: change.id,
      status: 'rejected',
      problems: ['participantReferenced'],
    });

    await device.removeParticipant(trip.id, ania);
    await device.sync(trip.id);

    const view = await device.read(trip.id);
    expect(view?.unsynced).toBe(0);
    expect(view?.deviceTrip.notices).toMatchObject([{ kind: 'removalRefused', participant: ania }]);

    await device.dismissNotice(trip.id, view!.deviceTrip.notices[0]!.id);
    expect((await device.read(trip.id))?.deviceTrip.notices).toEqual([]);
  });

  it('drops its Claim once a pull shows that Participant removed, noting it', async () => {
    const { server, device } = setUp();
    await device.createTrip(trip, token);
    server.snapshot = {
      ...pulledTrip,
      version: 9,
      participants: [ania],
      removedParticipants: [kasia],
      expenses: [],
    };

    await device.sync(trip.id);

    expect((await device.read(trip.id))?.deviceTrip).toMatchObject({
      claim: null,
      notices: [{ kind: 'claimRemoved', participant: kasia }],
    });
  });

  it('registers its push subscription on sync while notifications are on, following its Claim', async () => {
    const { server, device } = setUp();
    await device.createTrip(trip, token);
    await device.turnOnNotifications(trip.id, browserSubscription);

    await device.sync(trip.id);
    expect(server.subscriptions.get(trip.id)).toEqual({
      ...browserSubscription,
      claimId: kasia.id,
    });

    await device.claim(trip.id, ania);
    await device.sync(trip.id);
    await device.sync(trip.id);
    expect(server.subscriptions.get(trip.id)).toEqual({ ...browserSubscription, claimId: ania.id });
    // Sent once per Claim: an unchanged subscription is not sent again.
    expect(server.subscribeCalls).toBe(2);
  });

  it('sends its push subscription again once per run of the app, and a renewed one at once', async () => {
    const server = new FakeServer();
    const db = new DeviceDb(uuidv7());
    const device = createDevice(db, server, deviceId);
    await device.createTrip(trip, token);
    await device.turnOnNotifications(trip.id, browserSubscription);
    await device.sync(trip.id);

    // Opened again: the server may have dropped it meanwhile, as its push service said gone.
    const reopened = createDevice(db, server, deviceId);
    await reopened.sync(trip.id);
    await reopened.sync(trip.id);
    expect(server.subscribeCalls).toBe(2);

    const renewed = { ...browserSubscription, endpoint: 'https://push.example.com/renewed' };
    await reopened.renewSubscription(renewed);
    await reopened.sync(trip.id);
    expect(server.subscriptions.get(trip.id)).toEqual({ ...renewed, claimId: kasia.id });
  });

  it('removes its push subscription once notifications are off, after being offline', async () => {
    const { server, device } = setUp();
    await device.createTrip(trip, token);
    await device.turnOnNotifications(trip.id, browserSubscription);
    await device.sync(trip.id);

    server.offline = true;
    await device.turnOffNotifications(trip.id);
    await device.sync(trip.id);
    expect(server.subscriptions.has(trip.id)).toBe(true);

    server.offline = false;
    await device.sync(trip.id);
    expect(server.subscriptions.has(trip.id)).toBe(false);
  });

  it('removes the push subscription of a Trip forgotten offline once it is back online', async () => {
    const { server, device } = setUp();
    await device.createTrip(trip, token);
    await device.turnOnNotifications(trip.id, browserSubscription);
    await device.sync(trip.id);

    server.offline = true;
    await device.forgetTrip(trip.id);
    await device.syncForgotten();
    expect(server.subscriptions.has(trip.id)).toBe(true);

    server.offline = false;
    await device.syncForgotten();
    expect(server.subscriptions.has(trip.id)).toBe(false);
  });
});

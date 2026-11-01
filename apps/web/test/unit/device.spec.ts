import 'fake-indexeddb/auto';
import type {
  ChangeResult,
  Expense,
  PullResponse,
  PushRequest,
  PushResponse,
  SyncChange,
  TripSnapshot,
  TripWithParticipants,
} from '@osi/owe-yeah-domain';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it } from 'vitest';
import { DeviceDb } from '../../app/sync/db';
import { createDevice, type Transport } from '../../app/sync/device';

const deviceId = '0b6e8f3a-2c1d-4e5f-8a9b-1c2d3e4f5a6b';
const token = 'x'.repeat(43);
const kasia = { id: uuidv7(), name: 'Kasia' };
const ania = { id: uuidv7(), name: 'Ania' };

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
  answer = (change: SyncChange): ChangeResult => ({
    changeId: change.id,
    status: 'accepted',
    version: change.kind === 'expense' ? (change.baseVersion ?? 0) + 1 : null,
  });

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
    return { trip: snapshot && snapshot.version !== since ? snapshot : null };
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

const trip: TripWithParticipants = {
  id: uuidv7(),
  name: 'Croatia 2026',
  currency: 'EUR',
  participants: [kasia, ania],
};

function plainExpense(title: string, id = uuidv7()): Expense {
  return {
    id,
    title,
    currency: 'EUR',
    time: { instant: '2026-07-14T21:30:00Z', zone: 'Europe/Zagreb' },
    mainPayerId: kasia.id,
    lineItems: [{ unitPrice: 2450, split: { mode: 'even', participantIds: [kasia.id, ania.id] } }],
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
    const { server, device } = setUp();
    await device.createTrip(trip, token);
    await device.sync(trip.id);
    const lidl = plainExpense('Lidl Rovinj');
    await device.saveExpense(trip.id, lidl, { version: null });
    await device.sync(trip.id);
    const [synced] = (await device.read(trip.id))!.local!.expenses;
    // Someone else edits it first; this device's edit is a Conflict.
    server.snapshot = { ...trip, version: 9, expenses: [{ ...lidl, title: 'Spar', version: 2 }] };
    server.answer = (change) => ({
      changeId: change.id,
      status: 'conflict',
      current: { ...lidl, title: 'Spar', version: 2 },
    });
    await device.saveExpense(trip.id, { ...lidl, title: 'Konzum' }, synced!.base);

    await device.sync(trip.id);

    expect((await device.read(trip.id))?.local?.expenses).toMatchObject([
      { title: 'Konzum', unsynced: { status: 'conflict' } },
    ]);
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
});

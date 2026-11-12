import { randomBytes } from 'node:crypto';
import {
  PARTICIPANT_LIMIT,
  PUSH_LIMIT,
  type ChangeResult,
  type Expense,
  type ExpenseChange,
  type Participant,
  type ParticipantChange,
  type PullResponse,
  type PushEnvelope,
  type RateEntry,
  type StoredExpense,
  type SyncChange,
  type TripChange,
  type TripSnapshot,
  type TripWithParticipants,
} from '@osi/owe-yeah-domain';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { participants as participantRows } from '../../../server/db/schema';
import { createRates } from '../../../server/trip/rates';
import { createTripStore } from '../../../server/trip/store';
import {
  createTripSync,
  type AppliedExpenseChange,
  type Notifier,
  type TripSync,
} from '../../../server/trip/sync';
import { startFrankfurter } from '../../e2e/harness/frankfurter';
import { describeWithDocker } from '../../e2e/harness/postgres';
import { useMigratedDatabase } from '../database';

const describeDb = describeWithDocker();

// The rate provider the Trip sync's rates fetch from.
const frankfurter = await startFrankfurter();
afterAll(frankfurter.close);

// Every change in these tests comes from one device, without a Claim unless given.
const deviceId = uuidv7();

/** A Trip link token, as the device creating the Trip generates it. */
function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function participant(name: string): Participant {
  return { id: uuidv7(), name };
}

function newTrip(name = 'Croatia 2026', participants: Participant[] = []): TripWithParticipants {
  return { id: uuidv7(), name, currency: 'EUR', participants };
}

function tripChange(
  { name, currency }: Pick<TripWithParticipants, 'name' | 'currency'>,
  claimId: string | null = null,
): TripChange {
  return { id: uuidv7(), claimId, deviceId, kind: 'trip', trip: { name, currency } };
}

function participantChange(changed: Participant, removed = false): ParticipantChange {
  return {
    id: uuidv7(),
    claimId: null,
    deviceId,
    kind: 'participant',
    participant: changed,
    removed,
  };
}

function change(
  expense: Expense,
  baseVersion: number | null = null,
  claimId: string | null = null,
): ExpenseChange {
  return { id: uuidv7(), claimId, deviceId, kind: 'expense', baseVersion, expense, deleted: false };
}

/** A change deleting `expense`, its state kept as it was. */
function deletion(
  expense: Expense,
  baseVersion: number,
  claimId: string | null = null,
): ExpenseChange {
  return { ...change(expense, baseVersion, claimId), deleted: true };
}

/** `expense` as the pull returns it at `version`, made by `by` at whatever time. */
function stored(expense: Expense, version: number, by: string | null = null): StoredExpense {
  return { ...expense, version, deleted: false, edited: { by, at: expect.any(String) } };
}

/** The Trip's creation and its first Participants, as a device's outbox holds them. */
function creation(trip: TripWithParticipants): SyncChange[] {
  return [tripChange(trip), ...trip.participants.map((added) => participantChange(added))];
}

/** A plain Expense of 24.50 EUR paid by `payer`, split evenly between `ticked`. */
function plainExpense(payer: Participant, ticked: Participant[] = [payer]): Expense {
  return {
    id: uuidv7(),
    title: 'Lidl Rovinj',
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

const iso = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);

describeDb('Trip sync', () => {
  const db = useMigratedDatabase();
  // What the notifier was told, push by push.
  const notified: { tripId: string; applied: AppliedExpenseChange[] }[] = [];
  const recorder: Notifier = {
    async notifyAffected(tripId, applied) {
      notified.push({ tripId, applied: [...applied] });
    },
  };
  let sync: TripSync;

  beforeAll(() => {
    sync = createTripSync(
      db(),
      createTripStore(db()),
      createRates(db(), frankfurter.url),
      recorder,
    );
  });

  /** Pushes changes and returns their results, expecting the Trip link to be taken. */
  async function push(tripId: string, token: string, ...changes: PushEnvelope['changes']) {
    const response = await sync.push(tripId, token, { changes });
    if (response === 'invalidLink') throw new Error('The Trip link was refused');
    return response.results;
  }

  /** Pulls the Trip, expecting the Trip link to be taken. */
  async function pull(tripId: string, token: string, since?: number): Promise<PullResponse> {
    const response = await sync.pull(tripId, token, since);
    if (response === 'invalidLink') throw new Error('The Trip link was refused');
    return response;
  }

  async function pulled(tripId: string, token: string): Promise<TripSnapshot> {
    // Without `since`, the pull always carries the Trip.
    return (await pull(tripId, token)).trip!;
  }

  async function pulledParticipants(tripId: string, token: string): Promise<Participant[]> {
    return (await pulled(tripId, token)).participants;
  }

  /** Creates a Trip by its first push, as a device does, and returns its Trip link's token. */
  async function createdToken(trip: TripWithParticipants): Promise<string> {
    const token = newToken();
    const results = await push(trip.id, token, ...creation(trip));
    expect(results.every(({ status }) => status === 'accepted')).toBe(true);
    return token;
  }

  /** A Trip with Kasia and Ania, created through the sync. */
  async function tripWithKasiaAndAnia() {
    const kasia = participant('Kasia');
    const ania = participant('Ania');
    const trip = newTrip('Croatia 2026', [kasia, ania]);
    const token = await createdToken(trip);
    return { trip, token, kasia, ania };
  }

  /** A Trip with as many Participants as a Trip can have, created through the sync. */
  async function fullTrip() {
    const everyone = Array.from({ length: PARTICIPANT_LIMIT }, (_, index) =>
      participant(`Participant ${index + 1}`),
    );
    const trip = newTrip('Croatia 2026', everyone);
    const token = newToken();
    // The creation is one change more than a push holds.
    const changes = creation(trip);
    const results = [
      ...(await push(trip.id, token, ...changes.slice(0, PUSH_LIMIT))),
      ...(await push(trip.id, token, ...changes.slice(PUSH_LIMIT))),
    ];
    expect(results.every(({ status }) => status === 'accepted')).toBe(true);
    return { trip, token, everyone };
  }

  /** What the notifier was told about the Trip: the changes and versions of each push. */
  function notifiedOf(tripId: string) {
    return notified
      .filter((push) => push.tripId === tripId)
      .map(({ applied }) => applied.map(({ change, version }) => ({ id: change.id, version })));
  }

  it('accepts a Trip created offline on its first push, with Expenses in the same push', async () => {
    const kasia = participant('Kasia');
    const trip = newTrip('Croatia 2026', [kasia]);
    const token = newToken();
    const expense = plainExpense(kasia);

    const results = await push(trip.id, token, ...creation(trip), change(expense));

    expect(results.map(({ status }) => status)).toEqual(['accepted', 'accepted', 'accepted']);
    expect(await pulled(trip.id, token)).toMatchObject({
      ...trip,
      expenses: [stored(expense, 1)],
    });
  });

  it('accepts a retried creation of a Trip, keeping its token', async () => {
    const trip = newTrip('Croatia 2026', [participant('Kasia')]);
    const token = newToken();
    const changes = creation(trip);
    await push(trip.id, token, ...changes);

    const results = await push(trip.id, token, ...changes);

    expect(results.map(({ status }) => status)).toEqual(['accepted', 'accepted']);
    expect(await pulledParticipants(trip.id, token)).toEqual(trip.participants);
  });

  it("refuses to create a Trip under an id that is taken, keeping the first Trip's token", async () => {
    const trip = newTrip();
    const token = await createdToken(trip);

    expect(await sync.push(trip.id, newToken(), { changes: creation(trip) })).toBe('invalidLink');
    expect(await pull(trip.id, token)).toMatchObject({ trip: { id: trip.id } });
  });

  it('refuses a token too weak to be a Trip link, creating no Trip', async () => {
    const trip = newTrip();
    const weak = 'short-and-guessable';

    expect(await sync.push(trip.id, weak, { changes: creation(trip) })).toBe('invalidLink');
    expect(await sync.push(trip.id, newToken(), { changes: [] })).toBe('invalidLink');
  });

  it('refuses pulls and pushes without the right token, as if the Trip did not exist', async () => {
    const trip = newTrip();
    await createdToken(trip);
    const otherToken = await createdToken(newTrip('Tatry'));
    const ola = participantChange(participant('Ola'));

    expect(await sync.pull(trip.id, newToken())).toBe('invalidLink');
    expect(await sync.pull(trip.id, otherToken)).toBe('invalidLink');
    expect(await sync.pull(uuidv7(), otherToken)).toBe('invalidLink');
    expect(await sync.pull('not-a-uuid', otherToken)).toBe('invalidLink');
    expect(await sync.push(trip.id, otherToken, { changes: [ola] })).toBe('invalidLink');
    // A Trip the server doesn't have is only created by a push that creates it.
    expect(await sync.push(uuidv7(), newToken(), { changes: [ola] })).toBe('invalidLink');
  });

  it("refuses only a change it can't read, applying the rest of the push", async () => {
    const { trip, token, kasia } = await tripWithKasiaAndAnia();
    const ola = participantChange(participant('Ola'));
    const malformed = { id: uuidv7(), kind: 'participant', participant: { name: '' } };
    const expense = change(plainExpense(kasia));

    expect(await push(trip.id, token, ola, malformed, expense)).toEqual<ChangeResult[]>([
      { changeId: ola.id, status: 'accepted', version: null },
      { changeId: malformed.id, status: 'rejected', problems: ['malformed'] },
      { changeId: expense.id, status: 'accepted', version: 1 },
    ]);
    const { participants, expenses } = await pulled(trip.id, token);
    expect(participants.map(({ name }) => name)).toEqual(['Kasia', 'Ania', 'Ola']);
    expect(expenses).toEqual([stored(expense.expense, 1)]);
  });

  it('checks the Trip link before it reads any change', async () => {
    const trip = newTrip();
    await createdToken(trip);
    const malformed = { id: uuidv7(), kind: 'expense' };

    expect(await sync.push(trip.id, newToken(), { changes: [malformed] })).toBe('invalidLink');
  });

  it('applies each change of a retried push once, even after a later change by someone else', async () => {
    const { trip, token, kasia } = await tripWithKasiaAndAnia();
    const ola = participantChange(participant('Ola'));
    const expense = plainExpense(kasia);
    const created = change(expense);
    const edited = change({ ...expense, title: 'Konzum' }, 1);
    // The first push lands, but its device never hears back.
    await push(trip.id, token, ola, created, edited);
    await push(trip.id, token, change({ ...expense, title: 'Spar' }, 2));

    expect(await push(trip.id, token, ola, created, edited)).toEqual<ChangeResult[]>([
      { changeId: ola.id, status: 'accepted', version: null },
      { changeId: created.id, status: 'accepted', version: 1 },
      { changeId: edited.id, status: 'accepted', version: 2 },
    ]);
    const { participants, expenses } = await pulled(trip.id, token);
    expect(participants.map(({ name }) => name)).toEqual(['Kasia', 'Ania', 'Ola']);
    expect(expenses).toEqual([stored({ ...expense, title: 'Spar' }, 3)]);
  });

  it('pulls Participants whose names repeat, in the order they were added', async () => {
    const trip = newTrip('Croatia 2026', [participant('Kasia'), participant('Ania')]);
    const token = await createdToken(trip);
    const otherKasia = participant('Kasia');

    await push(trip.id, token, participantChange(otherKasia));

    expect(await pulledParticipants(trip.id, token)).toEqual([...trip.participants, otherKasia]);
  });

  it('keeps the last write when a Participant is renamed', async () => {
    const ania = participant('Ania');
    const trip = newTrip('Croatia 2026', [ania]);
    const token = await createdToken(trip);

    await push(trip.id, token, participantChange({ ...ania, name: 'Anna' }));

    expect(await pulledParticipants(trip.id, token)).toEqual([{ ...ania, name: 'Anna' }]);
  });

  it('refuses a Participant id another Trip uses', async () => {
    const ania = participant('Ania');
    await createdToken(newTrip('Tatry', [ania]));
    const trip = newTrip();
    const token = await createdToken(trip);
    const taken = participantChange({ ...ania, name: 'Ola' });

    expect(await push(trip.id, token, taken)).toEqual<ChangeResult[]>([
      { changeId: taken.id, status: 'rejected', problems: ['participantIdTaken'] },
    ]);
    expect(await pulledParticipants(trip.id, token)).toEqual([]);
  });

  it('refuses a Participant past the 100th, added or brought back, until one is removed', async () => {
    const { trip, token, everyone } = await fullTrip();
    const [first] = everyone;
    const marta = participant('Marta');
    const tooMany = participantChange(marta);

    expect(await push(trip.id, token, tooMany)).toEqual<ChangeResult[]>([
      { changeId: tooMany.id, status: 'rejected', problems: ['tooManyParticipants'] },
    ]);

    const kasia = { ...first!, name: 'Kasia' };
    const renamed = participantChange(kasia);
    const removed = participantChange(kasia, true);
    const added = participantChange(marta);
    const broughtBack = participantChange(kasia);
    expect(await push(trip.id, token, renamed, removed, added, broughtBack)).toEqual<
      ChangeResult[]
    >([
      { changeId: renamed.id, status: 'accepted', version: null },
      { changeId: removed.id, status: 'accepted', version: null },
      { changeId: added.id, status: 'accepted', version: null },
      { changeId: broughtBack.id, status: 'rejected', problems: ['tooManyParticipants'] },
    ]);
    const pulledTrip = await pulled(trip.id, token);
    expect(pulledTrip.participants).toHaveLength(100);
    expect(pulledTrip.participants).toContainEqual(marta);
    expect(pulledTrip.removedParticipants).toEqual([kasia]);
  });

  it('refuses an Expense that would bring back a removed Participant past the 100th', async () => {
    const { trip, token, everyone } = await fullTrip();
    const [payer, removed] = everyone;
    // Made offline before the removal and the 100th Participant.
    const offline = change(plainExpense(payer!, [payer!, removed!]));
    await push(trip.id, token, participantChange(removed!, true));
    await push(trip.id, token, participantChange(participant('Marta')));

    expect(await push(trip.id, token, offline)).toEqual<ChangeResult[]>([
      { changeId: offline.id, status: 'rejected', problems: ['tooManyParticipants'] },
    ]);
    expect(await pulled(trip.id, token)).toMatchObject({
      removedParticipants: [removed],
      expenses: [],
    });
  });

  it('takes an Expense that brings back nobody, even on a Trip past the 100th from before the limit', async () => {
    const { trip, token, everyone } = await fullTrip();
    // A 101st Participant, which Trip sync took before it counted them.
    await db()
      .insert(participantRows)
      .values({ ...participant('Marta'), tripId: trip.id, removed: false });
    const [payer] = everyone;
    const lunch = change(plainExpense(payer!));

    expect(await push(trip.id, token, lunch)).toEqual<ChangeResult[]>([
      { changeId: lunch.id, status: 'accepted', version: 1 },
    ]);
  });

  it('removes a Participant softly, but refuses while an Expense references them', async () => {
    const { trip, token, kasia, ania } = await tripWithKasiaAndAnia();
    await push(trip.id, token, change(plainExpense(kasia)));
    const removeAnia = participantChange(ania, true);
    const removeKasia = participantChange(kasia, true);

    expect(await push(trip.id, token, removeAnia, removeKasia)).toEqual<ChangeResult[]>([
      { changeId: removeAnia.id, status: 'accepted', version: null },
      { changeId: removeKasia.id, status: 'rejected', problems: ['participantReferenced'] },
    ]);
    expect(await pulled(trip.id, token)).toMatchObject({
      participants: [kasia],
      removedParticipants: [ania],
    });
  });

  it('brings back a removed Participant when an accepted Expense references them, saying so', async () => {
    const { trip, token, kasia, ania } = await tripWithKasiaAndAnia();
    await push(trip.id, token, participantChange(ania, true));
    // Made offline before Ania was removed.
    const offline = change(plainExpense(kasia, [kasia, ania]));

    expect(await push(trip.id, token, offline)).toEqual<ChangeResult[]>([
      { changeId: offline.id, status: 'accepted', version: 1, restored: [ania.id] },
    ]);
    expect(await pulled(trip.id, token)).toMatchObject({
      participants: [kasia, ania],
      removedParticipants: [],
    });
  });

  it('answers a retried Expense change with the Participants it brought back, applying it once', async () => {
    const { trip, token, kasia, ania } = await tripWithKasiaAndAnia();
    await push(trip.id, token, participantChange(ania, true));
    const offline = change(plainExpense(kasia, [kasia, ania]));
    const plain = change(plainExpense(kasia));
    // The first push lands, but its device never hears back.
    const first = await push(trip.id, token, offline, plain);

    const retried = await push(trip.id, token, offline, plain);

    expect(retried).toStrictEqual<ChangeResult[]>([
      { changeId: offline.id, status: 'accepted', version: 1, restored: [ania.id] },
      { changeId: plain.id, status: 'accepted', version: 1 },
    ]);
    expect(retried).toStrictEqual(first);
    expect(await createTripStore(db()).revisions(trip.id, offline.expense.id)).toHaveLength(1);
    expect(notifiedOf(trip.id)).toHaveLength(1);
  });

  it('keeps the last write of the Trip details, with who changed them and when', async () => {
    const { trip, token, kasia, ania } = await tripWithKasiaAndAnia();

    await push(trip.id, token, tripChange({ name: 'Chorwacja', currency: 'PLN' }, ania.id));
    await push(trip.id, token, tripChange({ name: 'Croatia', currency: 'PLN' }, kasia.id));

    expect(await pulled(trip.id, token)).toMatchObject({
      name: 'Croatia',
      currency: 'PLN',
      edited: { by: kasia.id, at: iso },
    });
  });

  it('creates an Expense at version 1, and pulls it', async () => {
    const { trip, token, kasia, ania } = await tripWithKasiaAndAnia();
    const created = change(plainExpense(kasia, [kasia, ania]));

    expect(await push(trip.id, token, created)).toEqual<ChangeResult[]>([
      { changeId: created.id, status: 'accepted', version: 1 },
    ]);
    expect((await pulled(trip.id, token)).expenses).toEqual([stored(created.expense, 1)]);
  });

  it('edits an Expense based on its current version, and bumps the version', async () => {
    const { trip, token, kasia, ania } = await tripWithKasiaAndAnia();
    const expense = plainExpense(kasia);
    await push(trip.id, token, change(expense));
    const edited = change({ ...expense, title: 'Konzum', mainPayerId: ania.id }, 1);

    expect(await push(trip.id, token, edited)).toEqual<ChangeResult[]>([
      { changeId: edited.id, status: 'accepted', version: 2 },
    ]);
    expect((await pulled(trip.id, token)).expenses).toEqual([stored(edited.expense, 2)]);
  });

  it('reports a Conflict for a change based on an older version, with who made the current one', async () => {
    const { trip, token, kasia, ania } = await tripWithKasiaAndAnia();
    const expense = plainExpense(kasia);
    await push(trip.id, token, change(expense));
    await push(trip.id, token, change({ ...expense, title: 'Konzum' }, 1, kasia.id));
    const stale = change({ ...expense, title: 'Spar' }, 1, ania.id);

    const current = stored({ ...expense, title: 'Konzum' }, 2, kasia.id);
    expect(await push(trip.id, token, stale)).toEqual<ChangeResult[]>([
      { changeId: stale.id, status: 'conflict', current, currentClaimId: kasia.id },
    ]);
    expect((await pulled(trip.id, token)).expenses).toEqual([current]);
  });

  it('refuses an Expense that breaks a Trip rule, saying why and keeping the Expense', async () => {
    const { trip, token, kasia } = await tripWithKasiaAndAnia();
    const expense = plainExpense(kasia);
    await push(trip.id, token, change(expense));
    const refused = change({ ...plainExpense(participant('Stranger')), id: expense.id }, 1);

    expect(await push(trip.id, token, refused)).toEqual<ChangeResult[]>([
      {
        changeId: refused.id,
        status: 'rejected',
        problems: ['unknownMainPayer', 'unknownParticipant'],
      },
    ]);
    expect((await pulled(trip.id, token)).expenses).toEqual([stored(expense, 1)]);
  });

  it('holds back only the Expenses it refuses, accepting the rest of the push', async () => {
    const { trip, token, kasia } = await tripWithKasiaAndAnia();
    const edited = plainExpense(kasia);
    await push(trip.id, token, change(edited));
    await push(trip.id, token, change({ ...edited, title: 'Konzum' }, 1));
    const stale = change({ ...edited, title: 'Spar' }, 1);
    const refused = change(plainExpense(participant('Stranger')));
    const accepted = change({ ...plainExpense(kasia), title: 'Ferry' });

    expect(await push(trip.id, token, stale, refused, accepted)).toEqual<ChangeResult[]>([
      {
        changeId: stale.id,
        status: 'conflict',
        current: stored({ ...edited, title: 'Konzum' }, 2),
        currentClaimId: null,
      },
      {
        changeId: refused.id,
        status: 'rejected',
        problems: ['unknownMainPayer', 'unknownParticipant'],
      },
      { changeId: accepted.id, status: 'accepted', version: 1 },
    ]);
    expect((await pulled(trip.id, token)).expenses.map(({ title }) => title)).toEqual([
      'Konzum',
      'Ferry',
    ]);
  });

  it("refuses an Expense id another Trip uses, and an edit of an Expense it doesn't have", async () => {
    const other = await tripWithKasiaAndAnia();
    const taken = plainExpense(other.kasia);
    await push(other.trip.id, other.token, change(taken));
    const { trip, token, kasia } = await tripWithKasiaAndAnia();
    const reused = change({ ...plainExpense(kasia), id: taken.id });
    const missing = change(plainExpense(kasia), 1);

    expect(await push(trip.id, token, reused, missing)).toEqual<ChangeResult[]>([
      { changeId: reused.id, status: 'rejected', problems: ['expenseIdTaken'] },
      { changeId: missing.id, status: 'rejected', problems: ['unknownExpense'] },
    ]);
    expect((await pulled(other.trip.id, other.token)).expenses).toEqual([stored(taken, 1)]);
  });

  it('deletes an Expense softly: the pull keeps it, marked deleted, with who deleted it', async () => {
    const { trip, token, kasia, ania } = await tripWithKasiaAndAnia();
    const expense = plainExpense(kasia);
    await push(trip.id, token, change(expense));
    const deleted = deletion(expense, 1, ania.id);

    expect(await push(trip.id, token, deleted)).toEqual<ChangeResult[]>([
      { changeId: deleted.id, status: 'accepted', version: 2 },
    ]);
    expect((await pulled(trip.id, token)).expenses).toEqual([
      { ...stored(expense, 2, ania.id), deleted: true },
    ]);
  });

  it('keeps every edit, delete and restore of an Expense as a Revision, newest first', async () => {
    const { trip, token, kasia, ania } = await tripWithKasiaAndAnia();
    const expense = plainExpense(kasia);
    const edited = { ...expense, title: 'Konzum', mainPayerId: ania.id };
    await push(trip.id, token, change(expense, null, kasia.id));
    await push(trip.id, token, change(edited, 1, ania.id));
    await push(trip.id, token, deletion(edited, 2, kasia.id));
    // Restoring the first Revision on top of the deletion.
    await push(trip.id, token, change(expense, 3));

    expect(await createTripStore(db()).revisions(trip.id, expense.id)).toEqual([
      { version: 4, expense, deleted: false, edited: { by: null, at: iso } },
      { version: 3, expense: edited, deleted: true, edited: { by: kasia.id, at: iso } },
      { version: 2, expense: edited, deleted: false, edited: { by: ania.id, at: iso } },
      { version: 1, expense, deleted: false, edited: { by: kasia.id, at: iso } },
    ]);
    expect((await pulled(trip.id, token)).expenses).toEqual([stored(expense, 4)]);
  });

  it('reports a Conflict for a restore based on an older version, adding no Revision', async () => {
    const { trip, token, kasia, ania } = await tripWithKasiaAndAnia();
    const expense = plainExpense(kasia);
    await push(trip.id, token, change(expense));
    await push(trip.id, token, deletion(expense, 1));
    // Kasia and Ania both restore the deleted Expense; Kasia syncs first.
    await push(trip.id, token, change(expense, 2, kasia.id));
    const restoredAgain = change(expense, 2, ania.id);

    expect(await push(trip.id, token, restoredAgain)).toEqual<ChangeResult[]>([
      {
        changeId: restoredAgain.id,
        status: 'conflict',
        current: stored(expense, 3, kasia.id),
        currentClaimId: kasia.id,
      },
    ]);
    expect(await createTripStore(db()).revisions(trip.id, expense.id)).toHaveLength(3);
  });

  it('answers a pull at the version the device has with no Trip, and a newer one in full', async () => {
    const { trip, token, kasia } = await tripWithKasiaAndAnia();
    const { version } = await pulled(trip.id, token);

    expect(await pull(trip.id, token, version)).toEqual({ trip: null, rates: [] });

    await push(trip.id, token, change(plainExpense(kasia)));
    const newer = await pull(trip.id, token, version);
    expect(newer.trip).toMatchObject({ id: trip.id, expenses: [{ title: 'Lidl Rovinj' }] });
    expect(newer.trip?.version).toBeGreaterThan(version);
  });

  it('changes the Trip currency without rewriting an Expense in another, converting it at the new pair', async () => {
    const { trip, token, kasia } = await tripWithKasiaAndAnia();
    frankfurter.set('2026-07-14', 'CHF', 'PLN', 4.5);
    const expense: Expense = { ...plainExpense(kasia), currency: 'CHF' };
    await push(trip.id, token, change(expense));
    const toPln = tripChange({ name: 'Croatia', currency: 'PLN' });

    expect(await push(trip.id, token, toPln)).toEqual<ChangeResult[]>([
      { changeId: toPln.id, status: 'accepted', version: null },
    ]);
    expect(await pull(trip.id, token)).toMatchObject({
      trip: { currency: 'PLN', expenses: [stored(expense, 1)] },
      rates: [{ date: '2026-07-14', from: 'CHF', to: 'PLN', rate: '4.5', fixed: true }],
    });
  });

  it('refuses a new Trip currency while the Trip has a Repayment, but still takes a rename', async () => {
    const { trip, token, kasia, ania } = await tripWithKasiaAndAnia();
    await push(trip.id, token, change(plainExpense(kasia, [kasia, ania])));
    const repayment: Expense = {
      id: uuidv7(),
      title: 'Repayment',
      currency: 'EUR',
      time: { instant: '2026-07-15T08:00:00Z', zone: 'Europe/Zagreb' },
      mainPayerId: ania.id,
      recipientId: kasia.id,
      amount: 1225,
    };
    await push(trip.id, token, change(repayment));
    const toPln = tripChange({ name: 'Croatia', currency: 'PLN' });
    const renamed = tripChange({ name: 'Croatia', currency: 'EUR' });

    expect(await push(trip.id, token, toPln, renamed)).toEqual<ChangeResult[]>([
      { changeId: toPln.id, status: 'rejected', problems: ['tripHasRepayments'] },
      { changeId: renamed.id, status: 'accepted', version: null },
    ]);
    expect(await pulled(trip.id, token)).toMatchObject({ name: 'Croatia', currency: 'EUR' });

    // Once the Repayment is deleted (in Recently deleted), the Trip currency is free again.
    const toPlnAgain = tripChange({ name: 'Croatia', currency: 'PLN' });
    await push(trip.id, token, deletion(repayment, 1));
    expect(await push(trip.id, token, toPlnAgain)).toEqual<ChangeResult[]>([
      { changeId: toPlnAgain.id, status: 'accepted', version: null },
    ]);
    expect(await pulled(trip.id, token)).toMatchObject({ currency: 'PLN' });
  });

  it('fills the fixed rate a foreign Expense needs on the pull, once, and never changes it', async () => {
    const { trip, token, kasia } = await tripWithKasiaAndAnia();
    frankfurter.set('2026-07-14', 'USD', 'EUR', 0.87593);
    await push(trip.id, token, change({ ...plainExpense(kasia), currency: 'USD' }));
    const usd: RateEntry = {
      date: '2026-07-14',
      from: 'USD',
      to: 'EUR',
      rate: '0.87593',
      fixed: true,
    };

    const { trip: first, rates } = await pull(trip.id, token);
    expect(rates).toEqual([usd]);
    const fetched = frankfurter.requests.length;
    frankfurter.set('2026-07-14', 'USD', 'EUR', 0.9);
    // Brought even while the Trip is unchanged.
    expect(await pull(trip.id, token, first!.version)).toEqual({ trip: null, rates: [usd] });
    expect(frankfurter.requests.length).toBe(fetched);
  });

  it('fixes the latest rate before a date the provider skipped, once it published a later one', async () => {
    const { trip, token, kasia } = await tripWithKasiaAndAnia();
    frankfurter.set('2026-07-10', 'SEK', 'EUR', 0.088);
    frankfurter.set('2026-07-13', 'SEK', 'EUR', 0.089);
    const time = { instant: '2026-07-12T10:00:00Z', zone: 'Europe/Stockholm' };
    await push(trip.id, token, change({ ...plainExpense(kasia), currency: 'SEK', time }));

    expect((await pull(trip.id, token)).rates).toEqual<RateEntry[]>([
      { date: '2026-07-12', from: 'SEK', to: 'EUR', rate: '0.088', fixed: true },
    ]);
  });

  it("fills today's rate as one not fixed yet, from the latest the provider has", async () => {
    const { trip, token, kasia } = await tripWithKasiaAndAnia();
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
    // Today's rate is not published yet.
    frankfurter.set(yesterday, 'GBP', 'EUR', 1.15);
    const time = { instant: now.toISOString(), zone: 'UTC' };
    await push(trip.id, token, change({ ...plainExpense(kasia), currency: 'GBP', time }));

    expect((await pull(trip.id, token)).rates).toEqual<RateEntry[]>([
      { date: today, from: 'GBP', to: 'EUR', rate: '1.15', fixed: false },
    ]);
  });

  it('pulls no rate for a currency the provider does not cover', async () => {
    const { trip, token, kasia } = await tripWithKasiaAndAnia();
    await push(trip.id, token, change({ ...plainExpense(kasia), currency: 'KPW' }));

    const { trip: pulledTrip, rates } = await pull(trip.id, token);
    expect(rates).toEqual([]);
    expect(pulledTrip?.expenses).toHaveLength(1);
  });

  it('keeps a Manual rate as typed, and pulls the rate it is chained through instead of its own', async () => {
    const { trip, token, kasia } = await tripWithKasiaAndAnia();
    frankfurter.set('2026-07-14', 'PLN', 'EUR', 0.235);
    // Typed while the Trip was in PLN: 1000 KPW were charged as 4.50 PLN.
    const expense: Expense = {
      ...plainExpense(kasia),
      currency: 'KPW',
      manualRate: { kind: 'charged', amount: 450, currency: 'PLN' },
    };
    await push(trip.id, token, change(expense));
    const fetched = frankfurter.requests.length;

    expect(await pull(trip.id, token)).toMatchObject({
      trip: { expenses: [stored(expense, 1)] },
      rates: [{ date: '2026-07-14', from: 'PLN', to: 'EUR', rate: '0.235', fixed: true }],
    });
    const bases = frankfurter.requests.slice(fetched).map((query) => query.get('base'));
    expect(bases).not.toContain('KPW');
  });

  it('tells the notifier about the Expense changes a push applied, with the versions they made', async () => {
    const { trip, token, kasia } = await tripWithKasiaAndAnia();
    const expense = plainExpense(kasia);
    const created = change(expense);
    const edited = change({ ...expense, title: 'Konzum' }, 1);

    await push(trip.id, token, created, edited, participantChange(participant('Ola')));

    expect(notifiedOf(trip.id)).toEqual([
      [
        { id: created.id, version: 1 },
        { id: edited.id, version: 2 },
      ],
    ]);
  });

  it('tells the notifier nothing of a Conflict, a rejected change, a retried one or Trip details', async () => {
    const { trip, token, kasia } = await tripWithKasiaAndAnia();
    const expense = plainExpense(kasia);
    const accepted = change(expense);
    await push(trip.id, token, accepted);

    await push(
      trip.id,
      token,
      // Retried, a Conflict (version 1 is taken), and an Expense paid by nobody in the Trip.
      accepted,
      change({ ...expense, title: 'Konzum' }),
      change(plainExpense(participant('Stranger'))),
      tripChange({ name: 'Croatia', currency: 'EUR' }),
    );

    expect(notifiedOf(trip.id)).toEqual([[{ id: accepted.id, version: 1 }]]);
  });
});

import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  TRIP_TOKEN_HEADER,
  type ChangeResult,
  type Expense,
  type ExpenseChange,
  type Participant,
  type ParticipantChange,
  type PullResponse,
  type PushResponse,
  type SyncChange,
  type TripChange,
  type TripSnapshot,
  type TripWithParticipants,
} from '@osi/owe-yeah-domain';
import { createTest, fetch } from '@nuxt/test-utils/e2e';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { describeWithDocker } from '../harness/postgres';

const describeApi = describeWithDocker();

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

function tripChange({ name, currency }: TripWithParticipants): TripChange {
  return { id: uuidv7(), claimId: null, deviceId, kind: 'trip', trip: { name, currency } };
}

function participantChange(added: Participant): ParticipantChange {
  return { id: uuidv7(), claimId: null, deviceId, kind: 'participant', participant: added };
}

function change(expense: Expense, baseVersion: number | null = null): ExpenseChange {
  return { id: uuidv7(), claimId: null, deviceId, kind: 'expense', baseVersion, expense };
}

/** A push as a device sends it; its changes may be ones the server refuses as malformed. */
function pushResponse(tripId: string, changes: unknown[], token?: string): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (token) headers.set(TRIP_TOKEN_HEADER, token);
  return fetch(`/api/trips/${tripId}/push`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ changes }),
  });
}

/** Pushes changes and returns their results, expecting the push itself to succeed. */
async function push(tripId: string, token: string, ...changes: SyncChange[]) {
  const response = await pushResponse(tripId, changes, token);
  expect(response.status).toBe(200);
  // SAFETY: a 200 from the push endpoint is a PushResponse, checked just above.
  const { results } = (await response.json()) as PushResponse;
  return results;
}

/** The Trip's creation and its first Participants, as a device's outbox holds them. */
function creation(trip: TripWithParticipants): SyncChange[] {
  return [tripChange(trip), ...trip.participants.map(participantChange)];
}

/** Creates a Trip by its first push, as a device does, and returns its Trip link's token. */
async function createdToken(trip: TripWithParticipants): Promise<string> {
  const token = newToken();
  const results = await push(trip.id, token, ...creation(trip));
  expect(results.every(({ status }) => status === 'accepted')).toBe(true);
  return token;
}

function pullTrip(id: string, token?: string, since?: number): Promise<Response> {
  return fetch(`/api/trips/${id}${since === undefined ? '' : `?since=${since}`}`, {
    headers: token ? { [TRIP_TOKEN_HEADER]: token } : {},
  });
}

async function pulled(tripId: string, token: string): Promise<TripSnapshot> {
  // SAFETY: a 200 from the whole-Trip pull without `since` always carries the Trip.
  return ((await (await pullTrip(tripId, token)).json()) as PullResponse).trip!;
}

async function pulledParticipants(tripId: string, token: string): Promise<Participant[]> {
  return (await pulled(tripId, token)).participants;
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
      { unitPrice: 2450, split: { mode: 'even', participantIds: ticked.map(({ id }) => id) } },
    ],
  };
}

/** A Trip with Kasia and Ania, created on the server. */
async function tripWithKasiaAndAnia() {
  const kasia = participant('Kasia');
  const ania = participant('Ania');
  const trip = newTrip('Croatia 2026', [kasia, ania]);
  const token = await createdToken(trip);
  return { trip, token, kasia, ania };
}

describeApi('Trip API', () => {
  // Builds and serves the app. The hooks are registered here rather than through `setup()`,
  // whose own `import('vitest')` misses the running suite when started from the repo root.
  const server = createTest({
    rootDir: fileURLToPath(new URL('../../..', import.meta.url)),
    server: true,
    env: { DATABASE_URL: inject('databaseUrl') },
  });
  beforeAll(server.beforeAll, server.ctx.options.setupTimeout);
  afterAll(server.afterAll, server.ctx.options.teardownTimeout);

  it('accepts a Trip created offline on its first push, with Expenses in the same push', async () => {
    const kasia = participant('Kasia');
    const trip = newTrip('Croatia 2026', [kasia]);
    const token = newToken();
    const expense = plainExpense(kasia);

    const results = await push(trip.id, token, ...creation(trip), change(expense));

    expect(results.map(({ status }) => status)).toEqual(['accepted', 'accepted', 'accepted']);
    expect(await pulled(trip.id, token)).toMatchObject({
      ...trip,
      expenses: [{ ...expense, version: 1 }],
    });
  });

  it('pulls Participants whose names repeat, in the order they were added', async () => {
    const trip = newTrip('Croatia 2026', [participant('Kasia'), participant('Ania')]);
    const token = await createdToken(trip);
    const otherKasia = participant('Kasia');

    await push(trip.id, token, participantChange(otherKasia));

    expect(await pulledParticipants(trip.id, token)).toEqual([...trip.participants, otherKasia]);
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
    expect(expenses).toEqual([{ ...expense, title: 'Spar', version: 3 }]);
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

  it('refuses a Participant with a blank name, and a Trip in a currency without rates', async () => {
    const trip = newTrip();
    const token = await createdToken(trip);
    const blank = participantChange(participant('  '));
    const hrk = { ...tripChange(newTrip()), trip: { name: 'Zagreb', currency: 'HRK' } };

    expect((await pushResponse(trip.id, [blank], token)).status).toBe(400);
    expect((await pushResponse(uuidv7(), [hrk], newToken())).status).toBe(400);
  });

  it('refuses a token too short to be a Trip link', async () => {
    const trip = newTrip();

    expect((await pushResponse(trip.id, creation(trip), 'short-and-guessable')).status).toBe(400);
  });

  it('refuses pulls and pushes without the right token, as if the Trip did not exist', async () => {
    const trip = newTrip();
    await createdToken(trip);
    const otherToken = await createdToken(newTrip('Tatry'));

    expect((await pullTrip(trip.id)).status).toBe(401);
    expect((await pullTrip(trip.id, newToken())).status).toBe(401);
    expect((await pullTrip(trip.id, otherToken)).status).toBe(401);
    expect((await pullTrip(uuidv7(), otherToken)).status).toBe(401);
    expect((await pullTrip('not-a-uuid', otherToken)).status).toBe(401);
    expect((await pushResponse(trip.id, [participantChange(participant('Ola'))])).status).toBe(401);
    // A Trip the server doesn't have is only created by a push that creates it.
    const unknown = uuidv7();
    const ola = participantChange(participant('Ola'));
    expect((await pushResponse(unknown, [ola], newToken())).status).toBe(401);
  });

  it("refuses to create a Trip under an id that is taken, keeping the first Trip's token", async () => {
    const trip = newTrip();
    const token = await createdToken(trip);

    expect((await pushResponse(trip.id, creation(trip), newToken())).status).toBe(401);
    expect((await pullTrip(trip.id, token)).status).toBe(200);
  });

  it('answers a pull at the version the device has with no Trip, and a newer one in full', async () => {
    const { trip, token, kasia } = await tripWithKasiaAndAnia();
    const { version } = await pulled(trip.id, token);

    expect(await (await pullTrip(trip.id, token, version)).json()).toEqual({ trip: null });

    await push(trip.id, token, change(plainExpense(kasia)));
    const newer = await (await pullTrip(trip.id, token, version)).json();
    expect(newer.trip).toMatchObject({ id: trip.id, expenses: [{ title: 'Lidl Rovinj' }] });
    expect(newer.trip.version).toBeGreaterThan(version);
  });

  it('creates an Expense through the push at version 1, and pulls it', async () => {
    const { trip, token, kasia, ania } = await tripWithKasiaAndAnia();
    const created = change(plainExpense(kasia, [kasia, ania]));

    expect(await push(trip.id, token, created)).toEqual<ChangeResult[]>([
      { changeId: created.id, status: 'accepted', version: 1 },
    ]);
    expect((await pulled(trip.id, token)).expenses).toEqual([{ ...created.expense, version: 1 }]);
  });

  it('edits an Expense based on its current version, and bumps the version', async () => {
    const { trip, token, kasia, ania } = await tripWithKasiaAndAnia();
    const expense = plainExpense(kasia);
    await push(trip.id, token, change(expense));
    const edited = change({ ...expense, title: 'Konzum', mainPayerId: ania.id }, 1);

    expect(await push(trip.id, token, edited)).toEqual<ChangeResult[]>([
      { changeId: edited.id, status: 'accepted', version: 2 },
    ]);
    expect((await pulled(trip.id, token)).expenses).toEqual([{ ...edited.expense, version: 2 }]);
  });

  it('reports a Conflict for a change based on an older version, keeping the Expense', async () => {
    const { trip, token, kasia } = await tripWithKasiaAndAnia();
    const expense = plainExpense(kasia);
    await push(trip.id, token, change(expense));
    await push(trip.id, token, change({ ...expense, title: 'Konzum' }, 1));
    const stale = change({ ...expense, title: 'Spar' }, 1);

    const current = { ...expense, title: 'Konzum', version: 2 };
    expect(await push(trip.id, token, stale)).toEqual<ChangeResult[]>([
      { changeId: stale.id, status: 'conflict', current },
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
    expect((await pulled(trip.id, token)).expenses).toEqual([{ ...expense, version: 1 }]);
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
    expect((await pulled(other.trip.id, other.token)).expenses).toEqual([{ ...taken, version: 1 }]);
  });

  it('refuses a push with a malformed Expense', async () => {
    const { trip, token, kasia } = await tripWithKasiaAndAnia();
    const blank = change({ ...plainExpense(kasia), title: ' ' });

    expect((await pushResponse(trip.id, [blank], token)).status).toBe(400);
  });
});

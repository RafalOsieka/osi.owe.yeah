import { fileURLToPath } from 'node:url';
import {
  TRIP_TOKEN_HEADER,
  type ChangeResult,
  type Expense,
  type ExpenseChange,
  type Participant,
  type PushResponse,
  type TripSnapshot,
  type TripWithParticipants,
} from '@osi/owe-yeah-domain';
import { createTest, fetch } from '@nuxt/test-utils/e2e';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { describeWithDocker } from '../harness/postgres';

const describeApi = describeWithDocker();

/** A creation request; its currency may be one the server refuses. */
type TripRequest = Omit<TripWithParticipants, 'currency'> & { currency: string };

function participant(name: string): Participant {
  return { id: uuidv7(), name };
}

function newTrip(name = 'Croatia 2026', participants: Participant[] = []): TripWithParticipants {
  return { id: uuidv7(), name, currency: 'EUR', participants };
}

function createTrip(trip: TripRequest): Promise<Response> {
  return fetch('/api/trips', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(trip),
  });
}

/** Creates a Trip and returns its Trip link's token. */
async function createdToken(trip: TripWithParticipants): Promise<string> {
  const response = await createTrip(trip);
  expect(response.status).toBe(201);
  // SAFETY: a 201 from POST /api/trips always carries `{ token }`, checked just above.
  const { token } = (await response.json()) as { token: string };
  return token;
}

function pullTrip(id: string, token?: string): Promise<Response> {
  return fetch(`/api/trips/${id}`, { headers: token ? { [TRIP_TOKEN_HEADER]: token } : {} });
}

function addParticipant(tripId: string, added: Participant, token?: string): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (token) headers.set(TRIP_TOKEN_HEADER, token);
  return fetch(`/api/trips/${tripId}/participants`, {
    method: 'POST',
    headers,
    body: JSON.stringify(added),
  });
}

async function pulled(tripId: string, token: string): Promise<TripSnapshot> {
  // SAFETY: a 200 from the whole-Trip pull is a TripSnapshot.
  return (await (await pullTrip(tripId, token)).json()) as TripSnapshot;
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

function change(expense: Expense, baseVersion: number | null = null): ExpenseChange {
  return { id: uuidv7(), baseVersion, expense };
}

function pushResponse(tripId: string, changes: ExpenseChange[], token?: string): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (token) headers.set(TRIP_TOKEN_HEADER, token);
  return fetch(`/api/trips/${tripId}/push`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ changes }),
  });
}

/** Pushes changes and returns their results, expecting the push itself to succeed. */
async function push(tripId: string, token: string, ...changes: ExpenseChange[]) {
  const response = await pushResponse(tripId, changes, token);
  expect(response.status).toBe(200);
  // SAFETY: a 200 from the push endpoint is a PushResponse, checked just above.
  const { results } = (await response.json()) as PushResponse;
  return results;
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

  it('creates a Trip anonymously and pulls it with its Trip link token', async () => {
    const trip = newTrip();
    const token = await createdToken(trip);

    const response = await pullTrip(trip.id, token);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...trip, expenses: [] });
  });

  it('creates a Trip with Participants whose names repeat, and pulls them in order', async () => {
    const trip = newTrip('Croatia 2026', [
      participant('Kasia'),
      participant('Ania'),
      participant('Kasia'),
    ]);
    const token = await createdToken(trip);

    expect(await pulledParticipants(trip.id, token)).toEqual(trip.participants);
  });

  it('adds a Participant later, also with a name already taken', async () => {
    const kasia = participant('Kasia');
    const trip = newTrip('Croatia 2026', [kasia]);
    const token = await createdToken(trip);
    const otherKasia = participant('Kasia');

    expect((await addParticipant(trip.id, otherKasia, token)).status).toBe(201);

    expect(await pulledParticipants(trip.id, token)).toEqual([kasia, otherKasia]);
  });

  it('adds a retried Participant only once', async () => {
    const trip = newTrip();
    const token = await createdToken(trip);
    const ania = participant('Ania');

    expect((await addParticipant(trip.id, ania, token)).status).toBe(201);
    expect((await addParticipant(trip.id, ania, token)).status).toBe(201);

    expect(await pulledParticipants(trip.id, token)).toEqual([ania]);
  });

  it('keeps the last write when a Participant is sent again under a new name', async () => {
    const trip = newTrip();
    const token = await createdToken(trip);
    const ania = participant('Ania');
    const renamed = { ...ania, name: 'Anna' };

    await addParticipant(trip.id, ania, token);
    const response = await addParticipant(trip.id, renamed, token);

    expect(await response.json()).toEqual(renamed);
    expect(await pulledParticipants(trip.id, token)).toEqual([renamed]);
  });

  it("refuses a Participant without the Trip's token, or with an id another Trip uses", async () => {
    const ania = participant('Ania');
    const other = newTrip('Tatry', [ania]);
    await createdToken(other);
    const trip = newTrip();
    const token = await createdToken(trip);

    expect((await addParticipant(trip.id, participant('Ola'))).status).toBe(401);
    expect((await addParticipant(trip.id, ania, token)).status).toBe(409);
    expect(await pulledParticipants(trip.id, token)).toEqual([]);
  });

  it('refuses a Participant with a blank name', async () => {
    const trip = newTrip();
    const token = await createdToken(trip);

    expect((await addParticipant(trip.id, participant('  '), token)).status).toBe(400);
  });

  it('refuses a pull without a token', async () => {
    const trip = newTrip();
    await createdToken(trip);

    expect((await pullTrip(trip.id)).status).toBe(401);
  });

  it("refuses a pull with a wrong token, including another Trip's", async () => {
    const trip = newTrip();
    await createdToken(trip);
    const otherToken = await createdToken(newTrip('Tatry'));

    expect((await pullTrip(trip.id, 'not-the-token')).status).toBe(401);
    expect((await pullTrip(trip.id, otherToken)).status).toBe(401);
  });

  it('refuses an unknown Trip the same way as a wrong token', async () => {
    const token = await createdToken(newTrip());

    expect((await pullTrip(uuidv7(), token)).status).toBe(401);
    expect((await pullTrip('not-a-uuid', token)).status).toBe(401);
  });

  it('refuses a Trip whose currency the rate provider does not cover', async () => {
    const response = await createTrip({ ...newTrip(), currency: 'HRK' });

    expect(response.status).toBe(400);
  });

  it('refuses to create a Trip with an id that is taken, keeping the first token valid', async () => {
    const trip = newTrip();
    const token = await createdToken(trip);

    expect((await createTrip(trip)).status).toBe(409);
    expect((await pullTrip(trip.id, token)).status).toBe(200);
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

  it('answers a retried change with its first result, applying it once', async () => {
    const { trip, token, kasia } = await tripWithKasiaAndAnia();
    const created = change(plainExpense(kasia));

    await push(trip.id, token, created);
    expect(await push(trip.id, token, created)).toEqual<ChangeResult[]>([
      { changeId: created.id, status: 'accepted', version: 1 },
    ]);
    expect((await pulled(trip.id, token)).expenses).toHaveLength(1);
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

  it("refuses a push without the Trip's token, or with a malformed Expense", async () => {
    const { trip, token, kasia } = await tripWithKasiaAndAnia();

    expect((await pushResponse(trip.id, [change(plainExpense(kasia))])).status).toBe(401);
    const blank = change({ ...plainExpense(kasia), title: ' ' });
    expect((await pushResponse(trip.id, [blank], token)).status).toBe(400);
  });
});

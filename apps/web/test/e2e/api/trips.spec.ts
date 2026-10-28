import { fileURLToPath } from 'node:url';
import {
  TRIP_TOKEN_HEADER,
  type Participant,
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

async function pulledParticipants(tripId: string, token: string): Promise<Participant[]> {
  // SAFETY: a 200 from the whole-Trip pull is a TripWithParticipants.
  const trip = (await (await pullTrip(tripId, token)).json()) as TripWithParticipants;
  return trip.participants;
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
    expect(await response.json()).toEqual(trip);
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
});

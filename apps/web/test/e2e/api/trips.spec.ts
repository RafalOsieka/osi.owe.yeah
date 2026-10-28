import { fileURLToPath } from 'node:url';
import { TRIP_TOKEN_HEADER, type Trip } from '@osi/owe-yeah-domain';
import { createTest, fetch } from '@nuxt/test-utils/e2e';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { describeWithDocker } from '../harness/postgres';

const describeApi = describeWithDocker();

/** A creation request; its currency may be one the server refuses. */
type TripRequest = Omit<Trip, 'currency'> & { currency: string };

function newTrip(name = 'Croatia 2026'): Trip {
  return { id: uuidv7(), name, currency: 'EUR' };
}

function createTrip(trip: TripRequest): Promise<Response> {
  return fetch('/api/trips', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(trip),
  });
}

/** Creates a Trip and returns its Trip link's token. */
async function createdToken(trip: Trip): Promise<string> {
  const response = await createTrip(trip);
  expect(response.status).toBe(201);
  // SAFETY: a 201 from POST /api/trips always carries `{ token }`, checked just above.
  const { token } = (await response.json()) as { token: string };
  return token;
}

function pullTrip(id: string, token?: string): Promise<Response> {
  return fetch(`/api/trips/${id}`, { headers: token ? { [TRIP_TOKEN_HEADER]: token } : {} });
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

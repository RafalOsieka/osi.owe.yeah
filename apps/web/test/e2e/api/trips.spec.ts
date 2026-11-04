import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  reminderMessageSchema,
  SYNC_SCHEMA_HEADER,
  SYNC_SCHEMA_VERSION,
  TRIP_TOKEN_HEADER,
  type ChangeResult,
  type Expense,
  type ExpenseChange,
  type Participant,
  type ParticipantChange,
  type PullResponse,
  type PushResponse,
  type RateEntry,
  type ReminderStatus,
  type RevisionsResponse,
  type StoredExpense,
  type SyncChange,
  type TripChange,
  type TripSnapshot,
  type TripWithParticipants,
} from '@osi/owe-yeah-domain';
import { createTest, fetch, startServer } from '@nuxt/test-utils/e2e';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, expect, inject, it, onTestFinished } from 'vitest';
import webpush from 'web-push';
import { startFrankfurter } from '../harness/frankfurter';
import { describeWithDocker } from '../harness/postgres';
import { startPushService } from '../harness/push-service';

const describeApi = describeWithDocker();

// The rate provider the server under test fetches from.
const frankfurter = await startFrankfurter();
// The push services devices subscribe with, and the server's VAPID keys.
const pushService = await startPushService();
const vapid = webpush.generateVAPIDKeys();

// The commit the server under test is started with, as an image built with `COMMIT_SHA` has it.
const commit = '0123456789abcdef0123456789abcdef01234567';

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

/**
 * The headers a device sends: its Trip link's token, if given, and the sync schema it speaks
 * (`null` for an app from before it said).
 */
function deviceHeaders(token?: string, schema: number | null = SYNC_SCHEMA_VERSION): Headers {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (token) headers.set(TRIP_TOKEN_HEADER, token);
  if (schema !== null) headers.set(SYNC_SCHEMA_HEADER, String(schema));
  return headers;
}

/** A push as a device sends it; its changes may be ones the server refuses as malformed. */
function pushResponse(
  tripId: string,
  changes: unknown[],
  token?: string,
  schema?: number | null,
): Promise<Response> {
  return fetch(`/api/trips/${tripId}/push`, {
    method: 'POST',
    headers: deviceHeaders(token, schema),
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
  return [tripChange(trip), ...trip.participants.map((added) => participantChange(added))];
}

/** Creates a Trip by its first push, as a device does, and returns its Trip link's token. */
async function createdToken(trip: TripWithParticipants): Promise<string> {
  const token = newToken();
  const results = await push(trip.id, token, ...creation(trip));
  expect(results.every(({ status }) => status === 'accepted')).toBe(true);
  return token;
}

function pullTrip(
  id: string,
  token?: string,
  since?: number,
  schema?: number | null,
): Promise<Response> {
  return fetch(`/api/trips/${id}${since === undefined ? '' : `?since=${since}`}`, {
    headers: deviceHeaders(token, schema),
  });
}

async function pulled(tripId: string, token: string): Promise<TripSnapshot> {
  // SAFETY: a 200 from the whole-Trip pull without `since` always carries the Trip.
  return ((await (await pullTrip(tripId, token)).json()) as PullResponse).trip!;
}

/** An Expense's Revisions, newest first, expecting the request to succeed. */
async function revisions(tripId: string, token: string, expenseId: string) {
  const response = await revisionsResponse(tripId, token, expenseId);
  expect(response.status).toBe(200);
  // SAFETY: a 200 from the Revisions endpoint is a RevisionsResponse, checked just above.
  return ((await response.json()) as RevisionsResponse).revisions;
}

function revisionsResponse(tripId: string, token: string, expenseId: string): Promise<Response> {
  return fetch(`/api/trips/${tripId}/expenses/${expenseId}/revisions`, {
    headers: deviceHeaders(token),
  });
}

/** The rate entries the whole-Trip pull brings, asked at the device's Trip version `since`. */
async function pulledRates(tripId: string, token: string, since?: number): Promise<RateEntry[]> {
  // SAFETY: a 200 from the whole-Trip pull is a PullResponse.
  return ((await (await pullTrip(tripId, token, since)).json()) as PullResponse).rates;
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
      {
        name: '',
        unitPrice: 2450,
        quantity: 1,
        split: { mode: 'even', participantIds: ticked.map(({ id }) => id) },
      },
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

/** Registers `device`'s push subscription to the Trip, for the Participant it claims. */
function subscribe(tripId: string, token: string | undefined, device: string, claimId: string) {
  return fetch(`/api/trips/${tripId}/subscriptions/${device}`, {
    method: 'PUT',
    headers: deviceHeaders(token),
    body: JSON.stringify({ ...pushService.subscription(device), claimId }),
  });
}

function unsubscribe(tripId: string, token: string, device: string) {
  return fetch(`/api/trips/${tripId}/subscriptions/${device}`, {
    method: 'DELETE',
    headers: deviceHeaders(token),
  });
}

/**
 * A Trip with Kasia, Ania and Ola, with a device subscribed for each of them, named after
 * the Participant it claims.
 */
async function subscribedTrip() {
  const kasia = participant('Kasia');
  const ania = participant('Ania');
  const ola = participant('Ola');
  const trip = newTrip('Croatia 2026', [kasia, ania, ola]);
  const token = await createdToken(trip);
  const devices = { kasia: uuidv7(), ania: uuidv7(), ola: uuidv7() };
  for (const [name, claim] of [
    ['kasia', kasia],
    ['ania', ania],
    ['ola', ola],
  ] as const) {
    expect((await subscribe(trip.id, token, devices[name], claim.id)).status).toBe(204);
  }
  return { trip, token, kasia, ania, ola, devices };
}

/** `from` reminds `to` of the Repayment `to` owes them, as `from`'s device asks. */
function remind(tripId: string, token: string, from: Participant, to: Participant) {
  return fetch(`/api/trips/${tripId}/reminders`, {
    method: 'POST',
    headers: deviceHeaders(token),
    body: JSON.stringify({ from: from.id, to: to.id }),
  });
}

/** How the server refused a Reminder: its status, and the refusal its body names. */
async function refusalOf(sending: Promise<Response>) {
  const response = await sending;
  return { status: response.status, body: await response.json() };
}

/** The Reminders `device` got, in the order they came, leaving out news of changes. */
function remindersOf(device: string): unknown[] {
  return pushService
    .payloadsOf(device)
    .filter((payload) => reminderMessageSchema.safeParse(payload).success);
}

/** Who a Reminder can reach in the Trip and who was reminded today, expecting it to succeed. */
async function reminderStatus(tripId: string, token: string): Promise<ReminderStatus> {
  const response = await fetch(`/api/trips/${tripId}/reminders`, {
    headers: deviceHeaders(token),
  });
  expect(response.status).toBe(200);
  // SAFETY: a 200 from the Reminders endpoint is a ReminderStatus, checked just above.
  return (await response.json()) as ReminderStatus;
}

/** What a device is sent about one change, as the only one or the latest of `count`. */
function activity(
  trip: TripWithParticipants,
  expense: Expense,
  latest: { author: string | null; action: string; paid: string; share: string },
  count = 1,
) {
  return {
    kind: 'activity',
    tripId: trip.id,
    tripName: trip.name,
    currency: trip.currency,
    count,
    latest: { expenseId: expense.id, title: expense.title, ...latest },
  };
}

describeApi('Trip API', () => {
  // Builds and serves the app. The hooks are registered here rather than through `setup()`,
  // whose own `import('vitest')` misses the running suite when started from the repo root.
  const server = createTest({
    rootDir: fileURLToPath(new URL('../../..', import.meta.url)),
    server: true,
    env: {
      DATABASE_URL: inject('databaseUrl'),
      NUXT_FRANKFURTER_URL: frankfurter.url,
      NUXT_VAPID_PUBLIC_KEY: vapid.publicKey,
      NUXT_VAPID_PRIVATE_KEY: vapid.privateKey,
      NUXT_VAPID_SUBJECT: 'mailto:test@example.com',
      // The stand-in push service is plain http; real ones are https only.
      NUXT_NOTIFICATIONS_ALLOW_HTTP: 'true',
      NUXT_COMMIT_SHA: commit,
    },
    // The PWA is off under Vitest for the nuxt suite's sake; this suite builds the real one,
    // to check how its files are cached.
    nuxtConfig: { pwa: { disable: false } },
  });
  beforeAll(server.beforeAll, server.ctx.options.setupTimeout);
  afterAll(server.afterAll, server.ctx.options.teardownTimeout);
  afterAll(frankfurter.close);
  afterAll(pushService.close);

  it('reports its health and the commit it runs, outside the sync schema', async () => {
    const response = await fetch('/healthz');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ commit });
  });

  it('has caches revalidate the service worker and the app shell, and keep hashed assets', async () => {
    const shell = await fetch('/');
    const script = /src="(\/_nuxt\/[^"]+\.js)"/.exec(await shell.text())?.[1];

    for (const path of ['/sw.js', '/', '/index.html', '/manifest.webmanifest']) {
      const response = await fetch(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('cache-control'), path).toBe('no-cache');
    }
    expect(script).toBeDefined();
    expect((await fetch(script!)).headers.get('cache-control')).toContain('immutable');
  });

  it('says it is no test environment unless switched on', async () => {
    const response = await fetch('/api/environment', { headers: deviceHeaders() });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ testEnvironment: false });
  });

  it('says it is a test environment when switched on', async () => {
    await startServer({ env: { NUXT_TEST_ENVIRONMENT: 'true' } });
    onTestFinished(() => startServer());

    const response = await fetch('/api/environment', { headers: deviceHeaders() });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ testEnvironment: true });
  });

  it('serves the licenses of the dependencies bundled into the app', async () => {
    const response = await fetch('/licenses.txt');

    expect(response.status).toBe(200);
    // Dexie runs only in the browser, under Apache-2.0, whose text it carries.
    expect(await response.text()).toMatch(/## dexie - [\d.]+ \(Apache-2\.0\)\n\n\s*Apache License/);
  });

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
    expect(expenses).toEqual([stored({ ...expense, title: 'Spar' }, 3)]);
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

  it('answers a push or pull in an older sync schema "update needed", applying nothing', async () => {
    const { trip, token, kasia } = await tripWithKasiaAndAnia();
    const before = await pulled(trip.id, token);
    const lidl = change(plainExpense(kasia));

    // `null`: an app from before the sync schema was sent.
    for (const schema of [SYNC_SCHEMA_VERSION - 1, null]) {
      const pushed = await pushResponse(trip.id, [lidl], token, schema);
      const pulledOlder = await pullTrip(trip.id, token, undefined, schema);

      expect([pushed.status, pulledOlder.status]).toEqual([426, 426]);
    }
    expect(await pulled(trip.id, token)).toEqual(before);
  });

  it('refuses an app newer than the server without telling it to update', async () => {
    const { trip, token, kasia } = await tripWithKasiaAndAnia();
    const newer = SYNC_SCHEMA_VERSION + 1;

    const pushed = await pushResponse(trip.id, [change(plainExpense(kasia))], token, newer);

    expect(pushed.status).toBe(409);
    expect((await pulled(trip.id, token)).expenses).toEqual([]);
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

    expect(await (await pullTrip(trip.id, token, version)).json()).toEqual({
      trip: null,
      rates: [],
    });

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

    const history = await revisions(trip.id, token, expense.id);

    const at = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    expect(history).toEqual([
      { version: 4, expense, deleted: false, edited: { by: null, at } },
      { version: 3, expense: edited, deleted: true, edited: { by: kasia.id, at } },
      { version: 2, expense: edited, deleted: false, edited: { by: ania.id, at } },
      { version: 1, expense, deleted: false, edited: { by: kasia.id, at } },
    ]);
    expect((await pulled(trip.id, token)).expenses).toEqual([stored(expense, 4)]);
    expect((await revisionsResponse(trip.id, newToken(), expense.id)).status).toBe(401);
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
    expect(await revisions(trip.id, token, expense.id)).toHaveLength(3);
  });

  it('keeps the last write of the Trip details, with who changed them and when', async () => {
    const { trip, token, kasia, ania } = await tripWithKasiaAndAnia();

    await push(trip.id, token, tripChange({ name: 'Chorwacja', currency: 'PLN' }, ania.id));
    await push(trip.id, token, tripChange({ name: 'Croatia', currency: 'PLN' }, kasia.id));

    expect(await pulled(trip.id, token)).toMatchObject({
      name: 'Croatia',
      currency: 'PLN',
      edited: { by: kasia.id, at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/) },
    });
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
    expect(await pulled(trip.id, token)).toMatchObject({
      currency: 'PLN',
      expenses: [stored(expense, 1)],
    });
    expect(await pulledRates(trip.id, token)).toEqual<RateEntry[]>([
      { date: '2026-07-14', from: 'CHF', to: 'PLN', rate: '4.5', fixed: true },
    ]);
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

    expect(await pulledRates(trip.id, token)).toEqual([usd]);
    const fetched = frankfurter.requests.length;
    frankfurter.set('2026-07-14', 'USD', 'EUR', 0.9);
    const { version } = await pulled(trip.id, token);
    // Brought even while the Trip is unchanged.
    expect(await pulledRates(trip.id, token, version)).toEqual([usd]);
    expect(frankfurter.requests.length).toBe(fetched);
  });

  it('fixes the latest rate before a date the provider skipped, once it published a later one', async () => {
    const { trip, token, kasia } = await tripWithKasiaAndAnia();
    frankfurter.set('2026-07-10', 'SEK', 'EUR', 0.088);
    frankfurter.set('2026-07-13', 'SEK', 'EUR', 0.089);
    const time = { instant: '2026-07-12T10:00:00Z', zone: 'Europe/Stockholm' };
    await push(trip.id, token, change({ ...plainExpense(kasia), currency: 'SEK', time }));

    expect(await pulledRates(trip.id, token)).toEqual<RateEntry[]>([
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

    expect(await pulledRates(trip.id, token)).toEqual<RateEntry[]>([
      { date: today, from: 'GBP', to: 'EUR', rate: '1.15', fixed: false },
    ]);
  });

  it('pulls no rate for a currency the provider does not cover', async () => {
    const { trip, token, kasia } = await tripWithKasiaAndAnia();
    await push(trip.id, token, change({ ...plainExpense(kasia), currency: 'KPW' }));

    expect(await pulledRates(trip.id, token)).toEqual([]);
    expect((await pulled(trip.id, token)).expenses).toHaveLength(1);
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

    expect((await pulled(trip.id, token)).expenses).toEqual([stored(expense, 1)]);
    expect(await pulledRates(trip.id, token)).toEqual<RateEntry[]>([
      { date: '2026-07-14', from: 'PLN', to: 'EUR', rate: '0.235', fixed: true },
    ]);
    const bases = frankfurter.requests.slice(fetched).map((query) => query.get('base'));
    expect(bases).not.toContain('KPW');
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

  it('registers a push subscription only with the Trip link', async () => {
    const { trip, token, kasia } = await tripWithKasiaAndAnia();

    expect((await subscribe(trip.id, undefined, uuidv7(), kasia.id)).status).toBe(401);
    expect((await subscribe(trip.id, newToken(), uuidv7(), kasia.id)).status).toBe(401);
    expect((await subscribe(trip.id, token, uuidv7(), kasia.id)).status).toBe(204);
  });

  it("notifies the devices of the Participants a change affects, but not the author's", async () => {
    const { trip, token, kasia, ania, devices } = await subscribedTrip();
    // 30.00 EUR paid by Kasia for herself and Ania; Ola is not in it.
    const expense = plainExpense(kasia, [kasia, ania]);
    const lidl = { ...expense, lineItems: [{ ...expense.lineItems[0]!, unitPrice: 3000 }] };

    await push(trip.id, token, change(lidl, null, kasia.id));

    const added = { author: 'Kasia', action: 'added', paid: '0.00', share: '15.00' };
    await expect
      .poll(() => pushService.payloadsOf(devices.ania))
      .toEqual([activity(trip, lidl, added)]);
    expect(pushService.payloadsOf(devices.ola)).toEqual([]);
    expect(pushService.payloadsOf(devices.kasia)).toEqual([]);

    // Ania deletes it: Kasia hears what she paid and her share are taken back.
    await push(trip.id, token, deletion(lidl, 1, ania.id));

    const deleted = { author: 'Ania', action: 'deleted', paid: '-30.00', share: '-15.00' };
    await expect
      .poll(() => pushService.payloadsOf(devices.kasia))
      .toEqual([activity(trip, lidl, deleted)]);
    expect(pushService.payloadsOf(devices.ania)).toHaveLength(1);
  });

  it('sends one notification per device for a push, about the latest change in it', async () => {
    const { trip, token, kasia, ola, devices } = await subscribedTrip();
    const first = plainExpense(kasia, [ola]);
    const second = { ...plainExpense(kasia, [kasia, ola]), title: 'Konzum' };

    await push(trip.id, token, change(first), change(second));

    const latest = { author: null, action: 'added', paid: '0.00', share: '12.25' };
    await expect
      .poll(() => pushService.payloadsOf(devices.ola))
      .toEqual([activity(trip, second, latest, 2)]);
  });

  it('notifies nobody of a Conflict, a rejected change or a retried one', async () => {
    const { trip, token, kasia, ania, ola, devices } = await subscribedTrip();
    const expense = plainExpense(kasia, [ania]);
    const accepted = change(expense, null, kasia.id);
    await push(trip.id, token, accepted);
    await expect.poll(() => pushService.payloadsOf(devices.ania)).toHaveLength(1);

    await push(
      trip.id,
      token,
      // Retried, a Conflict (version 1 is taken), and an Expense paid by nobody in the Trip.
      accepted,
      change({ ...expense, title: 'Konzum' }, null, kasia.id),
      change({ ...plainExpense(participant('Stranger'), [ania]) }, null, kasia.id),
    );
    // A change Ola hears about comes after them all.
    const later = plainExpense(kasia, [ania, ola]);
    await push(trip.id, token, change(later, null, kasia.id));

    await expect.poll(() => pushService.payloadsOf(devices.ola)).toHaveLength(1);
    await expect.poll(() => pushService.payloadsOf(devices.ania)).toHaveLength(2);
    expect(pushService.payloadsOf(devices.ania)[1]).toMatchObject({
      latest: { expenseId: later.id },
    });
  });

  it("follows a device's Claim, and stops once the device unsubscribes", async () => {
    const { trip, token, kasia, ania, ola, devices } = await subscribedTrip();
    // Ania's device now says it is Kasia: Kasia's own changes are not news to it.
    await subscribe(trip.id, token, devices.ania, kasia.id);
    expect((await unsubscribe(trip.id, token, devices.ola)).status).toBe(204);

    await push(trip.id, token, change(plainExpense(kasia, [ania, ola]), null, kasia.id));
    const forKasia = plainExpense(ania, [kasia]);
    await push(trip.id, token, change(forKasia, null, ania.id));

    await expect
      .poll(() => pushService.payloadsOf(devices.ania))
      .toEqual([
        activity(trip, forKasia, { author: 'Ania', action: 'added', paid: '0.00', share: '24.50' }),
      ]);
    expect(pushService.payloadsOf(devices.ola)).toEqual([]);
  });

  it('prunes a subscription its push service says is gone', async () => {
    const { trip, token, kasia, ania, ola, devices } = await subscribedTrip();
    pushService.gone(devices.ania);
    await push(trip.id, token, change(plainExpense(kasia, [ania, ola]), null, kasia.id));
    await expect.poll(() => pushService.payloadsOf(devices.ania)).toHaveLength(1);

    // The 410 is pruned after the push answered: from then on, a change Ania is in only
    // reaches Ola.
    await expect
      .poll(async () => {
        const [tried, reached] = [devices.ania, devices.ola].map(
          (device) => pushService.payloadsOf(device).length,
        );
        await push(trip.id, token, change(plainExpense(kasia, [ania, ola]), null, kasia.id));
        await expect.poll(() => pushService.payloadsOf(devices.ola)).toHaveLength(reached! + 1);
        return pushService.payloadsOf(devices.ania).length - tried!;
      })
      .toBe(0);
  });

  it('lets only the creditor of a current suggestion remind, sending it to the debtor', async () => {
    const { trip, token, kasia, ania, ola, devices } = await subscribedTrip();
    // 24.50 EUR paid by Kasia for herself and Ania: Ania pays Kasia 12.25.
    await push(trip.id, token, change(plainExpense(kasia, [kasia, ania])));

    // Ania owes, Ola is not in it, and nobody owes Ola.
    const notSuggested = { status: 403, body: { refused: 'notSuggested' } };
    expect(await refusalOf(remind(trip.id, token, ania, kasia))).toEqual(notSuggested);
    expect(await refusalOf(remind(trip.id, token, ola, ania))).toEqual(notSuggested);
    expect(await refusalOf(remind(trip.id, token, kasia, ola))).toEqual(notSuggested);
    expect((await remind(trip.id, newToken(), kasia, ania)).status).toBe(401);
    expect((await remind(trip.id, token, kasia, ania)).status).toBe(204);

    await expect
      .poll(() => remindersOf(devices.ania))
      .toEqual([
        {
          kind: 'reminder',
          tripId: trip.id,
          tripName: trip.name,
          currency: trip.currency,
          from: { id: kasia.id, name: 'Kasia' },
          to: ania.id,
          amount: '12.25',
        },
      ]);
    expect(remindersOf(devices.kasia)).toEqual([]);
    expect(remindersOf(devices.ola)).toEqual([]);
  });

  it('refuses a second Reminder for the same pair on the same day, and says so in the status', async () => {
    const { trip, token, kasia, ania, ola, devices } = await subscribedTrip();
    // Kasia paid 36.75 EUR for all three: Ania and Ola each pay her 12.25.
    const expense = plainExpense(kasia, [kasia, ania, ola]);
    const lidl = { ...expense, lineItems: [{ ...expense.lineItems[0]!, unitPrice: 3675 }] };
    await push(trip.id, token, change(lidl));

    expect((await remind(trip.id, token, kasia, ania)).status).toBe(204);
    expect(await refusalOf(remind(trip.id, token, kasia, ania))).toEqual({
      status: 429,
      body: { refused: 'remindedToday' },
    });
    // Another pair is not held back.
    expect((await remind(trip.id, token, kasia, ola)).status).toBe(204);

    await expect.poll(() => remindersOf(devices.ola)).toHaveLength(1);
    expect(remindersOf(devices.ania)).toHaveLength(1);
    expect(await reminderStatus(trip.id, token)).toEqual({
      reachable: expect.arrayContaining([kasia.id, ania.id, ola.id]),
      remindedToday: expect.arrayContaining([
        { from: kasia.id, to: ania.id },
        { from: kasia.id, to: ola.id },
      ]),
    });
  });

  it('refuses a Reminder to a debtor no device of whom can be notified, so the creditor shares it instead', async () => {
    const { trip, token, kasia, ania } = await tripWithKasiaAndAnia();
    await push(trip.id, token, change(plainExpense(kasia, [kasia, ania])));

    expect(await reminderStatus(trip.id, token)).toEqual({ reachable: [], remindedToday: [] });
    expect(await refusalOf(remind(trip.id, token, kasia, ania))).toEqual({
      status: 409,
      body: { refused: 'unreachable' },
    });
    // Refused, it holds nothing back for later that day.
    await subscribe(trip.id, token, uuidv7(), ania.id);
    expect((await remind(trip.id, token, kasia, ania)).status).toBe(204);
  });

  it('refuses a push with a malformed Expense', async () => {
    const { trip, token, kasia } = await tripWithKasiaAndAnia();
    const blank = change({ ...plainExpense(kasia), title: ' ' });

    expect((await pushResponse(trip.id, [blank], token)).status).toBe(400);
  });
});

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
  type PushKeys,
  type PushResponse,
  type RateLookup,
  type ReminderStatus,
  type ServerTrip,
  type StoredExpense,
  type SubscriptionRequest,
  type SyncChange,
  type TripChange,
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

/** `expense` as the pull returns it at `version`, made by `by` at whatever time. */
function stored(expense: Expense, version: number, by: string | null = null): StoredExpense {
  return { ...expense, version, deleted: false, edited: { by, at: expect.any(String) } };
}

/** A Content Security Policy's directives by name, each with its sources. */
function directives(policy: string | null | undefined): Map<string, string[]> {
  const parsed = (policy ?? '').split(';').flatMap((directive): [string, string[]][] => {
    const [name, ...sources] = directive.trim().split(/\s+/);
    return name ? [[name, sources]] : [];
  });
  return new Map(parsed);
}

/** A client address of its own, as Cloudflare names it in `CF-Connecting-IP`. */
function newAddress(): string {
  return [10, ...randomBytes(3)].join('.');
}

/**
 * The headers a device sends: its Trip link's token, if given, and the sync schema it speaks
 * (`null` for an app from before it said), and the client address Cloudflare adds. Each
 * request comes from an address of its own unless given, so the Trips this suite creates never
 * add up to the limit on creating them.
 */
function deviceHeaders(
  token?: string,
  schema: number | null = SYNC_SCHEMA_VERSION,
  address = newAddress(),
): Headers {
  const headers = new Headers({ 'content-type': 'application/json', 'cf-connecting-ip': address });
  if (token) headers.set(TRIP_TOKEN_HEADER, token);
  if (schema !== null) headers.set(SYNC_SCHEMA_HEADER, String(schema));
  return headers;
}

/**
 * A push as a device sends it, from `address` if given; its changes may be ones the server
 * refuses as malformed.
 */
function pushResponse(
  tripId: string,
  changes: unknown[],
  token?: string,
  schema?: number | null,
  address?: string,
): Promise<Response> {
  return fetch(`/api/trips/${tripId}/push`, {
    method: 'POST',
    headers: deviceHeaders(token, schema, address),
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

async function pulled(tripId: string, token: string): Promise<ServerTrip> {
  // SAFETY: a 200 from the whole-Trip pull without `since` always carries the Trip.
  return ((await (await pullTrip(tripId, token)).json()) as PullResponse).trip!;
}

function revisionsResponse(tripId: string, token: string, expenseId: string): Promise<Response> {
  return fetch(`/api/trips/${tripId}/expenses/${expenseId}/revisions`, {
    headers: deviceHeaders(token),
  });
}

/** The Expense form's lookup of the automatic rate of `from` on `date`. */
function rateResponse(
  tripId: string,
  token: string,
  from: string,
  date: string,
): Promise<Response> {
  return fetch(`/api/trips/${tripId}/rates?${new URLSearchParams({ from, date })}`, {
    headers: deviceHeaders(token),
  });
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

/**
 * Registers `device`'s push subscription to the Trip, for the Participant it claims: at the
 * stand-in push service with keys it decrypts with, or with the endpoint or keys of `overrides`.
 */
function subscribe(
  tripId: string,
  token: string | undefined,
  device: string,
  claimId: string,
  overrides: Partial<Pick<SubscriptionRequest, 'endpoint' | 'keys'>> = {},
) {
  const subscription = pushService.subscription(device);
  return fetch(`/api/trips/${tripId}/subscriptions/${device}`, {
    method: 'PUT',
    headers: deviceHeaders(token),
    body: JSON.stringify({ ...subscription, ...overrides, claimId }),
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
      // The stand-in push service is plain http on 127.0.0.1, no known push service.
      NUXT_NOTIFICATIONS_ANY_ENDPOINT: 'true',
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

  it("allows only its own origin by default, upgrades http: loads, and scripts neither by 'unsafe-inline' nor from any https: site", async () => {
    const shell = await fetch('/');
    // The service worker serves the shell's `index.html` for every page, without the headers.
    const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(
      await shell.text(),
    )?.[1];
    const policies = {
      shell: shell.headers.get('content-security-policy'),
      'shell meta': meta,
      page: (await fetch('/trips/new')).headers.get('content-security-policy'),
    };

    for (const [served, policy] of Object.entries(policies)) {
      const csp = directives(policy);
      expect(csp.get('default-src'), served).toEqual(["'self'"]);
      expect(csp.get('connect-src'), served).toEqual(["'self'"]);
      expect(csp.get('script-src'), served).not.toContain("'unsafe-inline'");
      expect(csp.get('script-src'), served).not.toContain('https:');
      expect(csp.has('upgrade-insecure-requests'), served).toBe(true);
    }
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

  it('accepts a Trip created offline on its first push, with Expenses in the same push, and pulls it', async () => {
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

  it("refuses only the changes it can't read, applying the rest of the push", async () => {
    const kasia = participant('Kasia');
    const trip = newTrip('Croatia 2026', [kasia]);
    const token = await createdToken(trip);
    const blank = participantChange(participant('  '));
    const untitled = change({ ...plainExpense(kasia), title: ' ' });
    const lidl = change(plainExpense(kasia));

    expect(await push(trip.id, token, blank, untitled, lidl)).toEqual<ChangeResult[]>([
      { changeId: blank.id, status: 'rejected', problems: ['malformed'] },
      { changeId: untitled.id, status: 'rejected', problems: ['malformed'] },
      { changeId: lidl.id, status: 'accepted', version: 1 },
    ]);
    // A Trip whose creation can't be read isn't created.
    const hrk = { ...tripChange(newTrip()), trip: { name: 'Zagreb', currency: 'HRK' } };
    expect((await pushResponse(uuidv7(), [hrk], newToken())).status).toBe(401);
  });

  it('refuses a push whose envelope or change ids it cannot read as a whole', async () => {
    const trip = newTrip();
    const token = await createdToken(trip);
    const ola = participantChange(participant('Ola'));

    expect((await pushResponse(trip.id, [], token)).status).toBe(400);
    expect((await pushResponse(trip.id, [{ ...ola, id: 'not-a-uuid' }], token)).status).toBe(400);
    expect((await pushResponse(trip.id, [{ ...ola, id: uuidv7() }, 'ola'], token)).status).toBe(
      400,
    );
  });

  it('refuses pulls and pushes without a valid Trip link, as if the Trip did not exist', async () => {
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
    const created = newTrip();
    expect((await pushResponse(created.id, creation(created), 'short-and-guessable')).status).toBe(
      401,
    );
    expect((await revisionsResponse(trip.id, otherToken, uuidv7())).status).toBe(401);
    expect((await rateResponse(trip.id, otherToken, 'HUF', '2026-07-14')).status).toBe(401);
    expect((await rateResponse(uuidv7(), otherToken, 'HUF', '2026-07-14')).status).toBe(401);
  });

  it("looks up the rate of a currency in the Trip's own on a date, before any Expense needs it", async () => {
    frankfurter.set('2026-07-14', 'BAM', 'EUR', 0.5113);
    const { trip, token } = await tripWithKasiaAndAnia();

    const response = await rateResponse(trip.id, token, 'BAM', '2026-07-14');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual<RateLookup>({
      status: 'found',
      entry: { date: '2026-07-14', from: 'BAM', to: 'EUR', rate: '0.5113', fixed: true },
    });
    expect((await rateResponse(trip.id, token, 'EUR', '2026-07-14')).status).toBe(400);
    expect((await rateResponse(trip.id, token, 'BAM', '14.07.2026')).status).toBe(400);
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

  it('creates at most 10 Trips an hour from one address, and still takes pushes to the Trips it has', async () => {
    const address = newAddress();
    const created: { trip: TripWithParticipants; token: string }[] = [];
    for (let count = 0; count < 10; count++) {
      const trip = newTrip(`Trip ${count + 1}`, [participant('Kasia')]);
      const token = newToken();
      expect((await pushResponse(trip.id, creation(trip), token, undefined, address)).status).toBe(
        200,
      );
      created.push({ trip, token });
    }
    const eleventh = newTrip('Trip 11');

    const tooMany = await pushResponse(
      eleventh.id,
      creation(eleventh),
      newToken(),
      undefined,
      address,
    );

    expect(tooMany.status).toBe(429);
    // A rename is a Trip change too, to a Trip the server has.
    const [{ trip, token }] = created;
    const [kasia] = trip.participants;
    const changes = [tripChange({ ...trip, name: 'Croatia 2026' }), change(plainExpense(kasia!))];
    const existing = await pushResponse(trip.id, changes, token, undefined, address);
    expect(existing.status).toBe(200);
    expect(await pulled(trip.id, token)).toMatchObject({ name: 'Croatia 2026', expenses: [{}] });
    expect((await pushResponse(eleventh.id, creation(eleventh), newToken())).status).toBe(200);
  });

  it('takes at most 200 push subscriptions in a Trip, and still replaces one it has', async () => {
    const { trip, token, kasia, devices } = await subscribedTrip();
    // Subscribed for Kasia, Ania and Ola so far.
    for (let count = 3; count < 200; count++) {
      expect((await subscribe(trip.id, token, uuidv7(), kasia.id)).status).toBe(204);
    }

    expect((await subscribe(trip.id, token, uuidv7(), kasia.id)).status).toBe(409);
    // Ania's device now says it is Kasia.
    expect((await subscribe(trip.id, token, devices.ania, kasia.id)).status).toBe(204);
  });

  it('registers and removes a push subscription only with the Trip link', async () => {
    const { trip, token, kasia } = await tripWithKasiaAndAnia();
    const device = uuidv7();

    expect((await subscribe(trip.id, undefined, device, kasia.id)).status).toBe(401);
    expect((await subscribe(trip.id, newToken(), device, kasia.id)).status).toBe(401);
    expect((await subscribe(trip.id, token, device, kasia.id)).status).toBe(204);
    expect((await unsubscribe(trip.id, token, device)).status).toBe(204);
  });

  it('takes a push subscription only at a known push service, as in production', async () => {
    await startServer({ env: { NUXT_NOTIFICATIONS_ANY_ENDPOINT: 'false' } });
    onTestFinished(() => startServer());
    const { trip, token, kasia } = await tripWithKasiaAndAnia();
    const device = uuidv7();

    expect((await subscribe(trip.id, token, device, kasia.id)).status).toBe(400);
    const fcm = `https://fcm.googleapis.com/fcm/send/${device}`;
    expect((await subscribe(trip.id, token, device, kasia.id, { endpoint: fcm })).status).toBe(204);
  });

  it('refuses a push subscription whose keys are too short to encrypt with', async () => {
    const { trip, token, kasia } = await tripWithKasiaAndAnia();
    const device = uuidv7();
    const valid = pushService.subscription(device).keys;
    // A browser's public key is 65 bytes and its auth secret 16: these are a byte short.
    const p256dh = randomBytes(64).toString('base64url');
    const auth = randomBytes(15).toString('base64url');
    const subscribeWith = (keys: PushKeys) => subscribe(trip.id, token, device, kasia.id, { keys });

    expect((await subscribeWith({ ...valid, p256dh })).status).toBe(400);
    expect((await subscribeWith({ ...valid, auth })).status).toBe(400);
    expect((await subscribeWith(valid)).status).toBe(204);
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
});

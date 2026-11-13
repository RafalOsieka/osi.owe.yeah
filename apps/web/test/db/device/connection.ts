import {
  pullResponseSchema,
  pushEnvelopeSchema,
  pushResponseSchema,
  rateLookupSchema,
  revisionsResponseSchema,
  subscriptionRequestSchema,
  type Currency,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type RateLookup,
  type ReminderStatus,
  type Revision,
  type SubscriptionRequest,
} from '@osi/owe-yeah-domain';
import type { z } from 'zod';
import { OfflineError, type Reminded, type Transport } from '../../../app/sync/device';
import type { Subscriptions } from '../../../server/notifications/subscriptions';
import type { Rates } from '../../../server/trip/rates';
import type { TripStore } from '../../../server/trip/store';
import type { TripSync } from '../../../server/trip/sync';

/**
 * `value` as it arrives on the other side of HTTP: through JSON, and checked by the schema
 * that side checks it with.
 */
function overTheWire<T>(schema: z.ZodType<T>, value: T): T {
  return schema.parse(JSON.parse(JSON.stringify(value)));
}

/**
 * A device's connection to the server's real Trip sync, in process (ADR 0004): the device's
 * `Transport`, behind a network the test controls. While `offline` nothing gets through; a
 * lost response reaches the server, but its answer never comes back. Calls outside the sync
 * protocol reach the server module behind them too (rate lookups, push subscriptions), or are
 * stubs until they get a module of their own: Reminders. While `failing`, the server answers
 * pushes and pulls with an error instead. The sync schema version is the HTTP adapter's
 * check; an in-process device is always built from the same code as the server.
 */
export class Connection implements Transport {
  offline = false;
  /** Whether the server answers pushes and pulls with an error, as a 5xx would. */
  failing = false;
  /** How many of the next pushes reach the server but lose their answer on the way back. */
  losePushResponses = 0;
  /** How many of the next pulls reach the server but lose their answer on the way back. */
  losePullResponses = 0;
  /** Every push that reached the server, in order, as the device sent it. */
  readonly pushes: PushRequest[] = [];
  /** How many registrations of a push subscription reached the server. */
  subscribeCalls = 0;

  constructor(
    private readonly sync: TripSync,
    private readonly store: TripStore,
    private readonly rates: Rates,
    private readonly subscriptions: Subscriptions,
  ) {}

  private throwIfOffline(): void {
    if (this.offline) throw new OfflineError();
  }

  private throwIfFailing(): void {
    if (this.failing) throw new Error('The server failed');
  }

  /** Throws for an answer lost on the way back, using up one of `counter`'s. */
  private throwIfLost(counter: 'losePushResponses' | 'losePullResponses'): void {
    if (this[counter] === 0) return;
    this[counter]--;
    throw new OfflineError();
  }

  async push(tripId: string, token: string, request: PushRequest): Promise<PushResponse> {
    this.throwIfOffline();
    this.throwIfFailing();
    this.pushes.push(request);
    // Only the envelope, as the HTTP adapter: Trip sync reads each change on its own.
    const response = await this.sync.push(tripId, token, overTheWire(pushEnvelopeSchema, request));
    this.throwIfLost('losePushResponses');
    if (response === 'invalidLink' || response === 'tooManyTrips') {
      throw new Error(`The push was refused: ${response}`);
    }
    return overTheWire(pushResponseSchema, response);
  }

  async pull(tripId: string, token: string, since?: number): Promise<PullResponse | 'invalidLink'> {
    this.throwIfOffline();
    this.throwIfFailing();
    const response = await this.sync.pull(tripId, token, since);
    this.throwIfLost('losePullResponses');
    if (response === 'invalidLink') return response;
    return overTheWire(pullResponseSchema, response);
  }

  async revisions(tripId: string, token: string, expenseId: string): Promise<Revision[]> {
    this.throwIfOffline();
    const trip = await this.store.tripByLink(tripId, token);
    if (!trip) throw new Error('The Trip link was refused');
    const revisions = await this.store.revisions(trip.id, expenseId);
    return overTheWire(revisionsResponseSchema, { revisions }).revisions;
  }

  async lookupRate(
    tripId: string,
    token: string,
    from: Currency,
    date: string,
  ): Promise<RateLookup> {
    this.throwIfOffline();
    const trip = await this.store.tripByLink(tripId, token);
    if (!trip) throw new Error('The Trip link was refused');
    return overTheWire(rateLookupSchema, await this.rates.lookup(date, from, trip.currency));
  }

  async subscribe(
    tripId: string,
    token: string,
    deviceId: string,
    request: SubscriptionRequest,
  ): Promise<void> {
    this.throwIfOffline();
    this.subscribeCalls++;
    const trip = await this.store.tripByLink(tripId, token);
    if (!trip) throw new Error('The Trip link was refused');
    const registration = await this.subscriptions.register(
      trip.id,
      deviceId,
      overTheWire(subscriptionRequestSchema, request),
    );
    if (registration !== 'registered')
      throw new Error(`The subscription was refused: ${registration}`);
  }

  async unsubscribe(tripId: string, token: string, deviceId: string): Promise<void> {
    this.throwIfOffline();
    const trip = await this.store.tripByLink(tripId, token);
    if (trip) await this.subscriptions.remove(trip.id, deviceId);
  }

  async reminderStatus(): Promise<ReminderStatus> {
    this.throwIfOffline();
    return { reachable: [], remindedToday: [] };
  }

  async remind(): Promise<Reminded> {
    this.throwIfOffline();
    return 'sent';
  }
}

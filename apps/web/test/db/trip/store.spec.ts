import { randomBytes } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { expect, it } from 'vitest';
import { changes, expenses, participants, revisions, trips } from '../../../server/db/schema';
import { createTripStore } from '../../../server/trip/store';
import { hashTripToken } from '../../../server/utils/trip-token';
import { describeWithDocker } from '../../e2e/harness/postgres';
import { useMigratedDatabase } from '../database';

const describeDb = describeWithDocker();

describeDb('Trip store', () => {
  const db = useMigratedDatabase();

  /** Stores a Trip under a fresh Trip link token, and returns both. */
  async function storedTrip() {
    const token = randomBytes(32).toString('base64url');
    const trip = { id: uuidv7(), name: 'Croatia 2026', currency: 'EUR' } as const;
    await db()
      .insert(trips)
      .values({ ...trip, tokenHash: hashTripToken(token) });
    return { trip, token };
  }

  it('reads a whole Trip, removed Participants and deleted Expenses included, through the domain', async () => {
    const { trip } = await storedTrip();
    const ana = { id: uuidv7(), name: 'Ana' };
    const ivo = { id: uuidv7(), name: 'Ivo' };
    await db()
      .insert(participants)
      .values([
        { ...ana, tripId: trip.id },
        { ...ivo, tripId: trip.id, removed: true },
      ]);
    const dinner = uuidv7();
    const taxi = uuidv7();
    const time = { instant: '2026-07-14T21:30:00Z', zone: 'Europe/Zagreb' };
    await db()
      .insert(expenses)
      .values([
        {
          id: dinner,
          tripId: trip.id,
          version: 1,
          // Stored before Line items had a name and a quantity.
          state: {
            title: 'Dinner',
            currency: 'EUR',
            time,
            mainPayerId: ana.id,
            lineItems: [{ unitPrice: 2450, split: { mode: 'even', participantIds: [ana.id] } }],
          },
        },
        {
          id: taxi,
          tripId: trip.id,
          version: 2,
          deleted: true,
          state: {
            title: 'Taxi',
            currency: 'EUR',
            time,
            mainPayerId: ivo.id,
            recipientId: ana.id,
            amount: 900,
          },
        },
      ]);
    const deletedAt = new Date('2026-07-15T08:00:00Z');
    await db()
      .insert(revisions)
      .values({
        expenseId: taxi,
        version: 2,
        tripId: trip.id,
        state: {
          title: 'Taxi',
          currency: 'EUR',
          time,
          mainPayerId: ivo.id,
          recipientId: ana.id,
          amount: 900,
        },
        deleted: true,
        claimId: ivo.id,
        deviceId: 'phone',
        createdAt: deletedAt,
      });
    const renamedAt = new Date('2026-07-16T10:00:00Z');
    await db().insert(changes).values({
      tripId: trip.id,
      subjectId: trip.id,
      claimId: ana.id,
      deviceId: 'phone',
      createdAt: renamedAt,
    });

    expect(await createTripStore(db()).readTrip(trip.id)).toEqual({
      ...trip,
      version: 1,
      edited: { by: ana.id, at: '2026-07-16T10:00:00.000Z' },
      participants: [
        { ...ana, removed: false },
        { ...ivo, removed: true },
      ],
      expenses: [
        {
          id: dinner,
          title: 'Dinner',
          currency: 'EUR',
          time,
          mainPayerId: ana.id,
          lineItems: [
            {
              name: '',
              unitPrice: 2450,
              quantity: 1,
              split: { mode: 'even', participantIds: [ana.id] },
            },
          ],
          version: 1,
          deleted: false,
          edited: null,
        },
        {
          id: taxi,
          title: 'Taxi',
          currency: 'EUR',
          time,
          mainPayerId: ivo.id,
          recipientId: ana.id,
          amount: 900,
          version: 2,
          deleted: true,
          edited: { by: ivo.id, at: '2026-07-15T08:00:00.000Z' },
        },
      ],
    });
  });

  it('reads no Trip it does not have', async () => {
    expect(await createTripStore(db()).readTrip(uuidv7())).toBeNull();
  });

  it("reads an Expense's Revisions newest first, and none for an Expense of another Trip", async () => {
    const { trip } = await storedTrip();
    const { trip: other } = await storedTrip();
    const ana = uuidv7();
    const expenseId = uuidv7();
    const time = { instant: '2026-07-14T21:30:00Z', zone: 'Europe/Zagreb' };
    const taxi = (amount: number) => ({
      title: 'Taxi',
      currency: 'EUR',
      time,
      mainPayerId: ana,
      recipientId: uuidv7(),
      amount,
    });
    const states = [taxi(900), taxi(1200), taxi(1200)];
    await db()
      .insert(expenses)
      .values({ id: expenseId, tripId: trip.id, version: 3, state: states[2]!, deleted: true });
    await db()
      .insert(revisions)
      .values(
        states.map((state, index) => ({
          expenseId,
          version: index + 1,
          tripId: trip.id,
          state,
          deleted: index === 2,
          claimId: index === 0 ? null : ana,
          deviceId: 'phone',
          createdAt: new Date(`2026-07-1${index + 4}T08:00:00Z`),
        })),
      );
    const store = createTripStore(db());

    expect(await store.revisions(trip.id, expenseId)).toEqual([
      {
        version: 3,
        expense: { ...states[2], id: expenseId },
        deleted: true,
        edited: { by: ana, at: '2026-07-16T08:00:00.000Z' },
      },
      {
        version: 2,
        expense: { ...states[1], id: expenseId },
        deleted: false,
        edited: { by: ana, at: '2026-07-15T08:00:00.000Z' },
      },
      {
        version: 1,
        expense: { ...states[0], id: expenseId },
        deleted: false,
        edited: { by: null, at: '2026-07-14T08:00:00.000Z' },
      },
    ]);
    expect(await store.revisions(other.id, expenseId)).toEqual([]);
  });

  it('finds a Trip by its link, with its version', async () => {
    const { trip, token } = await storedTrip();

    expect(await createTripStore(db()).tripByLink(trip.id, token)).toEqual({ ...trip, version: 1 });
  });

  it('gives nothing for a wrong token, an unknown Trip or an id that is no Trip id', async () => {
    const { trip } = await storedTrip();
    const { token: otherToken } = await storedTrip();
    const store = createTripStore(db());

    expect(await store.tripByLink(trip.id, otherToken)).toBeNull();
    expect(await store.tripByLink(uuidv7(), otherToken)).toBeNull();
    expect(await store.tripByLink('not-a-trip', otherToken)).toBeNull();
  });
});

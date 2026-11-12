import {
  editedSchema,
  expenseStateSchema,
  participantSchema,
  revisionSchema,
  storedExpenseSchema,
  tripIdSchema,
  tripSchema,
  tripVersionSchema,
  type Revision,
} from '@osi/owe-yeah-domain';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database, Transaction } from '../db/client';
import { changes, expenses, participants, revisions, trips } from '../db/schema';
import { hashTripToken } from '../utils/trip-token';

const storedTripSchema = tripSchema.extend({ version: tripVersionSchema });

/** A Trip as the server keeps it: its details and its current version. */
export type StoredTrip = z.infer<typeof storedTripSchema>;

const storedParticipantSchema = participantSchema.extend({ removed: z.boolean() });

/** A Participant as the server keeps them: removed ones are kept, softly. */
export type StoredParticipant = z.infer<typeof storedParticipantSchema>;

const wholeTripSchema = storedTripSchema.extend({
  edited: editedSchema.nullable(),
  participants: z.array(storedParticipantSchema),
  expenses: z.array(storedExpenseSchema),
});

/**
 * A whole Trip as the server keeps it: its details, who last changed them and when (`null`
 * where not known), its Participants, removed ones included, in the order they were added,
 * and its Expenses, deleted ones included, in the order they were created.
 */
export type WholeTrip = z.infer<typeof wholeTripSchema>;

/**
 * Every server read of a Trip, each parsed by the domain schemas on the way out, so their
 * defaults apply to rows stored before them. Expense state is untyped JSON until
 * `expenseStateSchema` parses it. Built on the database, or on a transaction to
 * read inside it. Reads are whole: consumers filter for themselves. Writes are the sync push's.
 */
export function createTripStore(db: Database | Transaction) {
  /** A Trip's Participants, removed ones included, in the order they were added. */
  function participantsOf(tripId: string) {
    return (
      db
        .select({ id: participants.id, name: participants.name, removed: participants.removed })
        .from(participants)
        .where(eq(participants.tripId, tripId))
        // Participants created in one transaction share `createdAt`; their UUIDv7 ids then
        // keep the order the device generated them in.
        .orderBy(asc(participants.createdAt), asc(participants.id))
    );
  }

  /**
   * A Trip's Expenses, deleted ones included, in the order they were created, each with who
   * made the version it is at and when: the Revision of that version.
   */
  async function expensesOf(tripId: string) {
    const rows = await db
      .select({
        id: expenses.id,
        version: expenses.version,
        state: expenses.state,
        deleted: expenses.deleted,
        editedBy: revisions.claimId,
        editedAt: revisions.createdAt,
      })
      .from(expenses)
      .leftJoin(
        revisions,
        and(eq(revisions.expenseId, expenses.id), eq(revisions.version, expenses.version)),
      )
      .where(eq(expenses.tripId, tripId))
      .orderBy(asc(expenses.createdAt), asc(expenses.id));
    return rows.map(({ id, version, state, deleted, editedBy, editedAt }) => ({
      ...expenseStateSchema.parse(state),
      id,
      version,
      deleted,
      edited: editedAt && { by: editedBy, at: editedAt.toISOString() },
    }));
  }

  /**
   * Who last changed the Trip's details and when: the Claim sent with the latest Trip change,
   * its creation included. `null` for a Trip without one.
   */
  async function editedOf(tripId: string) {
    const [latest] = await db
      .select({ by: changes.claimId, at: changes.createdAt })
      .from(changes)
      .where(and(eq(changes.tripId, tripId), eq(changes.subjectId, tripId)))
      .orderBy(desc(changes.createdAt), desc(changes.id))
      .limit(1);
    return latest ? { by: latest.by, at: latest.at.toISOString() } : null;
  }

  return {
    /** The whole Trip `tripId` names (`WholeTrip`), or `null` when there is none. */
    async readTrip(tripId: string): Promise<WholeTrip | null> {
      const [trip, tripParticipants, tripExpenses, edited] = await Promise.all([
        db
          .select({
            id: trips.id,
            name: trips.name,
            currency: trips.currency,
            version: trips.version,
          })
          .from(trips)
          .where(eq(trips.id, tripId))
          .then(([row]) => row),
        participantsOf(tripId),
        expensesOf(tripId),
        editedOf(tripId),
      ]);
      if (!trip) return null;
      return wholeTripSchema.parse({
        ...trip,
        edited,
        participants: tripParticipants,
        expenses: tripExpenses,
      });
    },

    /**
     * The Revisions of the Trip's Expense `expenseId`, newest first: none for an Expense the
     * Trip doesn't have.
     */
    async revisions(tripId: string, expenseId: string): Promise<Revision[]> {
      const rows = await db
        .select()
        .from(revisions)
        .where(and(eq(revisions.tripId, tripId), eq(revisions.expenseId, expenseId)))
        .orderBy(desc(revisions.version));
      return rows.map(({ version, state, deleted, claimId, createdAt }) =>
        revisionSchema.parse({
          version,
          expense: { ...expenseStateSchema.parse(state), id: expenseId },
          deleted,
          edited: { by: claimId, at: createdAt.toISOString() },
        }),
      );
    },

    /**
     * The Trip `tripId` names, if `token` is its Trip link's token: the only credential
     * (ADR 0001). A wrong token, an unknown Trip and an id that is no Trip id all give
     * `null` alike. Only a push creating a Trip can still tell that its id is taken (Trip
     * sync's `InvalidLink`), which is left as it is: guessing a UUIDv7 Trip id is infeasible.
     */
    async tripByLink(tripId: string, token: string): Promise<StoredTrip | null> {
      const id = tripIdSchema.safeParse(tripId);
      if (!id.success) return null;
      const [trip] = await db
        .select({
          id: trips.id,
          name: trips.name,
          currency: trips.currency,
          version: trips.version,
        })
        .from(trips)
        .where(and(eq(trips.id, id.data), eq(trips.tokenHash, hashTripToken(token))));
      return trip ? storedTripSchema.parse(trip) : null;
    },
  };
}

export type TripStore = ReturnType<typeof createTripStore>;

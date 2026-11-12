import { z } from 'zod';
import { expenseSchema } from './expense.ts';
import { participantIdSchema, participantSchema } from './participant.ts';
import { tripWithParticipantsSchema } from './trip.ts';

/** The server's version of an Expense: starts at 1 and goes up with every accepted change. */
export const expenseVersionSchema = z.number().int().positive();

/**
 * Who made a Revision, by the Claim sent with its change (`null` without one), and when, by
 * the server's clock. For display only: it grants nothing.
 */
export const editedSchema = z.object({
  by: participantIdSchema.nullable(),
  at: z.iso.datetime(),
});

export type Edited = z.infer<typeof editedSchema>;

/**
 * An Expense as the server stores it: the version a change must be based on, whether it is
 * deleted (soft, so it can be restored from Recently deleted), and who made this version and
 * when (`null` where not known).
 */
export const storedExpenseSchema = expenseSchema.and(
  z.object({
    version: expenseVersionSchema,
    deleted: z.boolean(),
    edited: editedSchema.nullable(),
  }),
);

export type StoredExpense = z.infer<typeof storedExpenseSchema>;

/**
 * One saved version of an Expense: every accepted edit, delete or restore adds one, and none
 * is ever changed or removed. Holds the whole Expense as that change left it.
 */
export const revisionSchema = z.object({
  version: expenseVersionSchema,
  expense: expenseSchema,
  deleted: z.boolean(),
  edited: editedSchema,
});

export type Revision = z.infer<typeof revisionSchema>;

/** What a change did to its Expense, as History and Notifications both say it. */
export const REVISION_KINDS = ['added', 'edited', 'deleted', 'restored'] as const;

export type RevisionKind = (typeof REVISION_KINDS)[number];

/**
 * What the change that made a Revision did, from the Revision before it (`null` for the first)
 * and whether the change left the Expense deleted. The first Revision is always `added`, even
 * one deleted at once; a deletion is `deleted`, even over another deletion.
 */
export function revisionKind(
  previous: Pick<Revision, 'deleted'> | null,
  deleted: boolean,
): RevisionKind {
  if (!previous) return 'added';
  if (deleted) return 'deleted';
  return previous.deleted ? 'restored' : 'edited';
}

/** A Trip's version: goes up with every change the server accepts into the Trip. */
export const tripVersionSchema = z.number().int().nonnegative();

/**
 * The whole Trip as the pull returns it: details, who last changed them and when (`null`
 * where not known), Participants and Expenses, at the Trip version they were read at.
 * Removed Participants are kept apart: no new Expense picks them, but older versions and
 * deleted Expenses still name them.
 */
export const serverTripSchema = tripWithParticipantsSchema.extend({
  version: tripVersionSchema,
  edited: editedSchema.nullable(),
  removedParticipants: z.array(participantSchema),
  expenses: z.array(storedExpenseSchema),
});

export type ServerTrip = z.infer<typeof serverTripSchema>;

/** Who takes part in a Trip, with those removed softly kept apart. */
export type TripPeople = Pick<ServerTrip, 'participants' | 'removedParticipants'>;

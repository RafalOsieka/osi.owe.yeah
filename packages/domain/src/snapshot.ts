import { z } from 'zod';
import { expenseSchema, type Expense } from './expense.ts';
import { participantIdSchema } from './participant.ts';
import { add, rational, subtract, type Rational } from './rational.ts';
import { expenseShares } from './shares.ts';
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
export const storedExpenseSchema = expenseSchema.extend({
  version: expenseVersionSchema,
  deleted: z.boolean(),
  edited: editedSchema.nullable(),
});

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

/** A Trip's version: goes up with every change the server accepts into the Trip. */
export const tripVersionSchema = z.number().int().nonnegative();

/**
 * The whole Trip as the pull returns it: details, Participants and Expenses, at the Trip
 * version they were read at.
 */
export const tripSnapshotSchema = tripWithParticipantsSchema.extend({
  version: tripVersionSchema,
  expenses: z.array(storedExpenseSchema),
});

export type TripSnapshot = z.infer<typeof tripSnapshotSchema>;

/** What one Participant paid, their share of the costs, and the difference, in the Trip currency. */
export type ParticipantBalance = {
  participantId: string;
  paid: Rational;
  share: Rational;
  /** Positive when the Participant is owed money, negative when they owe. */
  balance: Rational;
};

/**
 * Every Participant's balance, exact and unrounded, in the order of the Trip's Participants.
 * The Main payer pays each Expense in full; each Line item is split evenly between its ticked
 * Participants. Expenses must be in the Trip currency (`expenseProblems` enforces it).
 */
export function balances(
  trip: Pick<TripSnapshot, 'currency' | 'participants'> & { expenses: readonly Expense[] },
): ParticipantBalance[] {
  const zero = rational(0n);
  const paid = new Map<string, Rational>();
  const share = new Map<string, Rational>();
  const credit = (totals: Map<string, Rational>, id: string, amount: Rational) =>
    totals.set(id, add(totals.get(id) ?? zero, amount));

  for (const expense of trip.expenses) {
    if (expense.currency !== trip.currency) {
      throw new RangeError(`Expense ${expense.id} is not in the Trip currency`);
    }
    const { total, shares } = expenseShares(expense);
    credit(paid, expense.mainPayerId, total);
    for (const [id, part] of shares) credit(share, id, part);
  }

  return trip.participants.map(({ id }) => {
    const participantPaid = paid.get(id) ?? zero;
    const participantShare = share.get(id) ?? zero;
    return {
      participantId: id,
      paid: participantPaid,
      share: participantShare,
      balance: subtract(participantPaid, participantShare),
    };
  });
}

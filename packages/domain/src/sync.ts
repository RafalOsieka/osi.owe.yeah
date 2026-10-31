import { z } from 'zod';
import { expenseSchema, type ExpenseProblem } from './expense.ts';
import { expenseVersionSchema, type StoredExpense } from './snapshot.ts';

/**
 * One change to an Expense, as the device's outbox sends it (ADR 0002): the Expense's full
 * new state plus the version it was based on (`null` when creating it). The change's own id
 * makes a retry idempotent.
 */
export const expenseChangeSchema = z.object({
  id: z.uuid(),
  baseVersion: expenseVersionSchema.nullable(),
  expense: expenseSchema,
});

export type ExpenseChange = z.infer<typeof expenseChangeSchema>;

/** A push: changes to apply in order. Each is accepted or refused on its own. */
export const pushRequestSchema = z.object({
  changes: z.array(expenseChangeSchema).min(1).max(100),
});

export type PushRequest = z.infer<typeof pushRequestSchema>;

/**
 * Why the server refused a change outright: a Trip rule (`expenseProblems`), an id another
 * Trip's Expense uses, or an edit of an Expense the server does not have.
 */
export type PushProblem = ExpenseProblem | 'expenseIdTaken' | 'unknownExpense';

/**
 * The outcome of one change. `accepted` gives the Expense's new version. `conflict` means
 * the Expense changed since the base version and gives its current state. `rejected` says
 * why. Refused changes leave the stored Expense as it was.
 */
export type ChangeResult = { changeId: string } & (
  | { status: 'accepted'; version: number }
  | { status: 'conflict'; current: StoredExpense }
  | { status: 'rejected'; problems: PushProblem[] }
);

export type PushResponse = { results: ChangeResult[] };

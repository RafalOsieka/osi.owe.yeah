import { z } from 'zod';
import { expenseProblemSchema, expenseSchema } from './expense.ts';
import { participantIdSchema, participantSchema } from './participant.ts';
import {
  expenseVersionSchema,
  revisionSchema,
  storedExpenseSchema,
  tripSnapshotSchema,
} from './snapshot.ts';
import { tripSchema } from './trip.ts';

/**
 * Who made a change and where (stored for display only, they grant nothing): the Claim on
 * the device at change time, or `null` without one, and the device's opaque id. The change's
 * own id, a UUIDv7 from the device, makes a retry idempotent (ADR 0002).
 */
const changeMeta = {
  id: z.uuid({ version: 'v7' }),
  claimId: participantIdSchema.nullable(),
  deviceId: z.uuid(),
};

/**
 * A Trip's details, last-write-wins (ADR 0002). Pushed to a Trip the server doesn't have
 * yet, it creates the Trip under the request's token: that is how a Trip created offline
 * reaches the server.
 */
export const tripChangeSchema = z.object({
  ...changeMeta,
  kind: z.literal('trip'),
  trip: tripSchema.omit({ id: true }),
});

/** A Participant added or renamed, last-write-wins (ADR 0002); never a Conflict. */
export const participantChangeSchema = z.object({
  ...changeMeta,
  kind: z.literal('participant'),
  participant: participantSchema,
});

/**
 * One change to an Expense (ADR 0002): its full new state, whether it is deleted, and the
 * version it was based on (`null` when creating it). Accepted only if that version is still
 * current. Deleting and restoring are changes like any edit: the state stays, `deleted` flips.
 */
export const expenseChangeSchema = z.object({
  ...changeMeta,
  kind: z.literal('expense'),
  baseVersion: expenseVersionSchema.nullable(),
  expense: expenseSchema,
  deleted: z.boolean(),
});

/** One change from a device's outbox. */
export const syncChangeSchema = z.discriminatedUnion('kind', [
  tripChangeSchema,
  participantChangeSchema,
  expenseChangeSchema,
]);

export type TripChange = z.infer<typeof tripChangeSchema>;
export type ParticipantChange = z.infer<typeof participantChangeSchema>;
export type ExpenseChange = z.infer<typeof expenseChangeSchema>;
export type SyncChange = z.infer<typeof syncChangeSchema>;

/** A push: changes to apply in order. Each is accepted or refused on its own. */
export const pushRequestSchema = z.object({
  changes: z.array(syncChangeSchema).min(1).max(100),
});

export type PushRequest = z.infer<typeof pushRequestSchema>;

/**
 * Why the server refused a change outright: a Trip rule (`expenseProblems`), an id another
 * Trip uses, or an edit of an Expense the server does not have.
 */
export const pushProblemSchema = z.enum([
  ...expenseProblemSchema.options,
  'expenseIdTaken',
  'unknownExpense',
  'participantIdTaken',
]);

export type PushProblem = z.infer<typeof pushProblemSchema>;

/**
 * The outcome of one change. `accepted` gives an Expense's new version (`null` for Trip
 * and Participant changes, which have none). `conflict` means the Expense changed since the
 * base version and gives its current state, with the Claim sent with the change that made it
 * (`null` without one). `rejected` says why. Refused changes leave the Trip as it was.
 */
export const changeResultSchema = z.discriminatedUnion('status', [
  z.object({
    changeId: z.uuid(),
    status: z.literal('accepted'),
    version: expenseVersionSchema.nullable(),
  }),
  z.object({
    changeId: z.uuid(),
    status: z.literal('conflict'),
    current: storedExpenseSchema,
    currentClaimId: participantIdSchema.nullable(),
  }),
  z.object({
    changeId: z.uuid(),
    status: z.literal('rejected'),
    problems: z.array(pushProblemSchema).min(1),
  }),
]);

export type ChangeResult = z.infer<typeof changeResultSchema>;

export const pushResponseSchema = z.object({ results: z.array(changeResultSchema) });

export type PushResponse = z.infer<typeof pushResponseSchema>;

/**
 * The whole-Trip pull (ADR 0002). Asked with the Trip version the device has, it answers
 * `trip: null` while the Trip is still at that version.
 */
export const pullResponseSchema = z.object({ trip: tripSnapshotSchema.nullable() });

export type PullResponse = z.infer<typeof pullResponseSchema>;

/** An Expense's Revisions, newest first, as History shows them. */
export const revisionsResponseSchema = z.object({ revisions: z.array(revisionSchema) });

export type RevisionsResponse = z.infer<typeof revisionsResponseSchema>;

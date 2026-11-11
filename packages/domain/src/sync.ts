import { z } from 'zod';
import { expenseProblemSchema, expenseSchema } from './expense.ts';
import { participantIdSchema, participantSchema } from './participant.ts';
import { rateEntrySchema } from './rates.ts';
import {
  expenseVersionSchema,
  revisionSchema,
  storedExpenseSchema,
  tripSnapshotSchema,
  tripVersionSchema,
} from './snapshot.ts';
import { tripSchema } from './trip.ts';

/**
 * The sync schema: the shape of pushes, pulls and Revisions. The server speaks only the
 * newest one and answers an older app's requests to `/api` with 426 "update needed" (ADR
 * 0002). Bump it whenever an older app could no longer talk to the server: the wire contract
 * test (`test/wire-contract.spec.ts`) fails on any wire schema change until that is decided.
 * It counts apart from the device store's version: not every store change touches the wire. A
 * bump that changes what the outbox has to send also appends a link to the store's migration
 * chain (`migrations` in the web app), so queued changes go out in the new schema.
 */
export const SYNC_SCHEMA_VERSION = 3;

/** The request header that carries the sync schema version the app speaks. */
export const SYNC_SCHEMA_HEADER = 'x-sync-schema';

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
 * reaches the server. A new Trip currency rewrites no Expense: each is converted at the rate
 * for the new pair (ADR 0003).
 */
export const tripChangeSchema = z.object({
  ...changeMeta,
  kind: z.literal('trip'),
  trip: tripSchema.omit({ id: true }),
});

/**
 * A Participant added, renamed, removed or brought back, last-write-wins (ADR 0002); never a
 * Conflict. Removing is soft, and refused while an Expense references the Participant.
 */
export const participantChangeSchema = z.object({
  ...changeMeta,
  kind: z.literal('participant'),
  participant: participantSchema,
  removed: z.boolean(),
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

/** How many changes one push holds at most. */
export const PUSH_LIMIT = 100;

/** A push: changes to apply in order. Each is accepted or refused on its own. */
export const pushRequestSchema = z.object({
  changes: z.array(syncChangeSchema).min(1).max(PUSH_LIMIT),
});

export type PushRequest = z.infer<typeof pushRequestSchema>;

/**
 * A push as the server reads its body: only the envelope, 1 to 100 changes, each with a
 * UUIDv7 id. Each change is then read on its own (`syncChangeSchema`), so one it can't read
 * is refused as `malformed` without holding back the rest.
 */
export const pushEnvelopeSchema = z.object({
  changes: z
    .array(z.looseObject({ id: changeMeta.id }))
    .min(1)
    .max(PUSH_LIMIT),
});

export type PushEnvelope = z.infer<typeof pushEnvelopeSchema>;

/**
 * Why the server refused a change outright: a Trip rule (`expenseProblems`), an id another
 * Trip uses, an edit of an Expense the server does not have, removing a Participant an
 * Expense references, a new Trip currency once the Trip has a Repayment
 * (`tripCurrencyLocked`), a change it can't read (`malformed`, not `syncChangeSchema`), or a
 * Participant change or Expense change that would make the Trip's live Participants more than
 * `PARTICIPANT_LIMIT`, by adding one or bringing removed ones back, or a new Expense past
 * `EXPENSE_LIMIT`.
 */
export const pushProblemSchema = z.enum([
  ...expenseProblemSchema.options,
  'expenseIdTaken',
  'unknownExpense',
  'participantIdTaken',
  'participantReferenced',
  'tripHasRepayments',
  'malformed',
  'tooManyParticipants',
  'tooManyExpenses',
]);

export type PushProblem = z.infer<typeof pushProblemSchema>;

/**
 * The outcome of one change. `accepted` gives an Expense's new version (`null` for Trip
 * and Participant changes, which have none), and the removed Participants the Expense brought
 * back by referencing them, if it did. `conflict` means the Expense changed since the
 * base version and gives its current state, with the Claim sent with the change that made it
 * (`null` without one). `rejected` says why. Refused changes leave the Trip as it was.
 */
export const changeResultSchema = z.discriminatedUnion('status', [
  z.object({
    changeId: z.uuid(),
    status: z.literal('accepted'),
    version: expenseVersionSchema.nullable(),
    restored: z.array(participantIdSchema).min(1).optional(),
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

/** The pull's query: `since`, the Trip version the device has, if it has the Trip. */
export const pullQuerySchema = z.object({
  since: z.coerce.number().pipe(tripVersionSchema).optional(),
});

/**
 * The whole-Trip pull (ADR 0002). Asked with the Trip version the device has, it answers
 * `trip: null` while the Trip is still at that version. It always brings the rate entries the
 * Trip's Expenses need (ADR 0003), as they change without the Trip changing: a Provisional
 * rate becomes fixed once its date is over.
 */
export const pullResponseSchema = z.object({
  trip: tripSnapshotSchema.nullable(),
  rates: z.array(rateEntrySchema),
});

export type PullResponse = z.infer<typeof pullResponseSchema>;

/** An Expense's Revisions, newest first, as History shows them. */
export const revisionsResponseSchema = z.object({ revisions: z.array(revisionSchema) });

export type RevisionsResponse = z.infer<typeof revisionsResponseSchema>;

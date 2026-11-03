import { z } from 'zod';
import { expenseIdSchema, expenseTitleSchema, type Expense } from './expense.ts';
import { participantIdSchema, participantNameSchema } from './participant.ts';
import { subtract, type Rational } from './rational.ts';
import { balances, type TripExpenses } from './settle-up.ts';
import { TRIP_CURRENCIES, tripIdSchema, tripNameSchema } from './trip.ts';

/** How one change moved what a Participant paid and their share, exactly, in the Trip currency. */
export type BalanceChange = { participantId: string; paid: Rational; share: Rational };

/**
 * Who a change of one Expense affects, for push notifications: every Participant whose share
 * or what they paid differs between the Trip's balances before and after the change, with
 * by how much, in the order of the Trip's Participants. `before` and `after` are the Expense
 * as it was and as the change left it, `null` where it did not exist or was deleted. As
 * balances add up Expense by Expense, the rest of the Trip makes no difference and is left
 * out. An Expense without a rate counts for nothing, as in balances.
 */
export function balanceChanges(
  trip: Omit<TripExpenses, 'expenses'>,
  before: Expense | null,
  after: Expense | null,
): BalanceChange[] {
  const of = (expense: Expense | null) => balances({ ...trip, expenses: expense ? [expense] : [] });
  const was = of(before);
  return of(after).flatMap(({ participantId, paid, share }, index) => {
    const change = {
      participantId,
      paid: subtract(paid, was[index]!.paid),
      share: subtract(share, was[index]!.share),
    };
    return change.paid.numerator === 0n && change.share.numerator === 0n ? [] : [change];
  });
}

/** A signed amount rounded to the Trip currency's minor units, as `roundMoney` writes it. */
const decimalSchema = z.string().regex(/^-?\d+(\.\d+)?$/);

/**
 * What a push notification about a Trip's activity carries: structured data the service
 * worker writes the text from in the device's language, so the server needs no i18n. `count`
 * is how many changes affecting the recipient it stands for; `latest` is the last of them:
 * who made it (`null` without a Claim), what it did, and how it moved what the recipient
 * paid and their share, rounded, in the Trip currency.
 */
export const activityMessageSchema = z.object({
  kind: z.literal('activity'),
  tripId: tripIdSchema,
  tripName: tripNameSchema,
  currency: z.enum(TRIP_CURRENCIES),
  count: z.number().int().positive(),
  latest: z.object({
    expenseId: expenseIdSchema,
    title: expenseTitleSchema,
    author: participantNameSchema.nullable(),
    action: z.enum(['added', 'changed', 'deleted', 'restored']),
    paid: decimalSchema,
    share: decimalSchema,
  }),
});

export type ActivityMessage = z.infer<typeof activityMessageSchema>;

/**
 * What a Reminder's push notification carries (#42), sent to the debtor's devices: who
 * reminds them (the creditor), the debtor it is for, and the Suggested Repayment's amount,
 * rounded, in the Trip currency.
 */
export const reminderMessageSchema = z.object({
  kind: z.literal('reminder'),
  tripId: tripIdSchema,
  tripName: tripNameSchema,
  currency: z.enum(TRIP_CURRENCIES),
  from: z.object({ id: participantIdSchema, name: participantNameSchema }),
  to: participantIdSchema,
  amount: decimalSchema,
});

export type ReminderMessage = z.infer<typeof reminderMessageSchema>;

/** Every push message the server sends, told apart by `kind`. */
export const pushMessageSchema = z.discriminatedUnion('kind', [
  activityMessageSchema,
  reminderMessageSchema,
]);

export type PushMessage = z.infer<typeof pushMessageSchema>;

/**
 * A device's push subscription to one Trip, as it registers it: the browser's push endpoint
 * and keys, the device's opaque id, and the Participant it claims, whose changes it is told
 * about. Registering again replaces it, e.g. when the Claim changes.
 */
export const subscriptionRequestSchema = z.object({
  endpoint: z.url({ protocol: /^https?$/ }).max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(200) }),
  claimId: participantIdSchema,
});

export type SubscriptionRequest = z.infer<typeof subscriptionRequestSchema>;

/** The server's VAPID public key, which a device subscribes to push with. */
export const pushKeyResponseSchema = z.object({ publicKey: z.string().min(1) });

export type PushKeyResponse = z.infer<typeof pushKeyResponseSchema>;

/**
 * A Reminder as the creditor's device asks for it (#42): `from`, the creditor it claims,
 * reminds `to` of the Suggested Repayment `to` owes them. Not a change: never in the outbox.
 */
export const reminderRequestSchema = z.object({
  from: participantIdSchema,
  to: participantIdSchema,
});

export type ReminderRequest = z.infer<typeof reminderRequestSchema>;

/**
 * What a creditor's device needs to know before it reminds anyone: whom a Reminder can reach
 * (Participants with a device subscribed to the Trip; anyone else is sent a shared message
 * instead), and the pairs reminded today (UTC), which can't be reminded again until tomorrow.
 */
export const reminderStatusSchema = z.object({
  reachable: z.array(participantIdSchema),
  remindedToday: z.array(reminderRequestSchema),
});

export type ReminderStatus = z.infer<typeof reminderStatusSchema>;

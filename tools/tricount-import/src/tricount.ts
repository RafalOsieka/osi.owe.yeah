import { z } from 'zod';

/**
 * What the importer reads of a Tricount, as the unofficial API returns it from
 * `GET /v1/user/{id}/registry` (see
 * `docs/research/tricount-export.md` on the `research/tricount-export` branch). Every
 * object comes wrapped in its type name, e.g. `{ "RegistryEntry": { … } }`; parsing unwraps
 * them and keeps only what the import uses. Categories, attachments and stamps are dropped.
 */

/** An amount as a decimal string in a currency, e.g. `{ value: "-12.50", currency: "EUR" }`. */
const moneySchema = z.object({ value: z.string().regex(/^-?\d+(\.\d+)?$/), currency: z.string() });

export type TricountMoney = z.infer<typeof moneySchema>;

/** A member of a Tricount; deleted ones stay so that old entries still name them. */
const membershipSchema = z
  .object({
    RegistryMembershipNonUser: z.object({
      id: z.number().int(),
      alias: z.object({ display_name: z.string() }),
      status: z.string(),
    }),
  })
  .transform(({ RegistryMembershipNonUser: member }) => ({
    id: member.id,
    name: member.alias.display_name,
    deleted: member.status === 'DELETED',
  }));

/**
 * One member's part of an entry: in the Tricount currency, and in the entry's own if foreign.
 * Its membership is a trimmed copy without `status`, so only the id is read.
 */
const allocationSchema = z
  .object({
    membership: z.object({ RegistryMembershipNonUser: z.object({ id: z.number().int() }) }),
    amount: moneySchema,
    amount_local: moneySchema.nullish(),
    type: z.enum(['AMOUNT', 'RATIO']),
    share_ratio: z.number().int().nullish(),
  })
  .transform((allocation) => ({
    memberId: allocation.membership.RegistryMembershipNonUser.id,
    amount: allocation.amount,
    amountLocal: allocation.amount_local ?? undefined,
    // The weight of a `RATIO` allocation; `null` for an exact `AMOUNT`.
    ratio: allocation.type === 'RATIO' ? (allocation.share_ratio ?? null) : null,
  }));

/**
 * A transaction: `NORMAL` is an Expense, `INCOME` money received for the group, `BALANCE` a
 * Repayment. `amount` is in the Tricount currency, `amount_local` in the currency it was paid
 * in when that differs. Signs vary by type, so only magnitudes are used. `date` is local
 * wall-clock time without a zone.
 */
const entrySchema = z
  .object({
    RegistryEntry: z.object({
      id: z.number().int(),
      status: z.string(),
      type_transaction: z.enum(['NORMAL', 'INCOME', 'BALANCE']),
      description: z.string().nullish(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/),
      amount: moneySchema,
      amount_local: moneySchema.nullish(),
      membership_owned: membershipSchema,
      allocations: z.array(allocationSchema),
    }),
  })
  .transform(({ RegistryEntry: entry }) => ({
    id: entry.id,
    active: entry.status === 'ACTIVE',
    kind: entry.type_transaction,
    description: entry.description ?? '',
    date: entry.date,
    amount: entry.amount,
    amountLocal: entry.amount_local ?? undefined,
    payerId: entry.membership_owned.id,
    allocations: entry.allocations,
  }));

const responseSchema = z.object({
  Response: z.tuple(
    [
      z.object({
        Registry: z.object({
          title: z.string(),
          currency: z.string(),
          memberships: z.array(membershipSchema),
          all_registry_entry: z.array(entrySchema),
        }),
      }),
    ],
    z.unknown(),
  ),
});

/** A Tricount as the import reads it: its title, base currency, members and entries. */
export type TricountRegistry = {
  title: string;
  currency: string;
  members: z.infer<typeof membershipSchema>[];
  entries: z.infer<typeof entrySchema>[];
};

/** Reads a saved or freshly fetched registry response; throws when it is not one. */
export function parseTricount(raw: string): TricountRegistry {
  const [{ Registry: registry }] = responseSchema.parse(JSON.parse(raw)).Response;
  return {
    title: registry.title,
    currency: registry.currency,
    members: registry.memberships,
    entries: registry.all_registry_entry,
  };
}

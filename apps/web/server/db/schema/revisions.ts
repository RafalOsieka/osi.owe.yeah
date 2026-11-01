import type { ExpenseState } from '@osi/owe-yeah-domain';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { expenses } from './expenses';
import { trips } from './trips';

/**
 * Every version an Expense has had: each accepted edit, delete or restore adds one, in the
 * transaction that applied it. Rows are only ever inserted, never changed or removed. Who made
 * it is kept as the device said, for display only: its Claim then and its opaque device id.
 */
export const revisions = pgTable(
  'revisions',
  {
    expenseId: uuid()
      .notNull()
      .references(() => expenses.id, { onDelete: 'cascade' }),
    // The Expense version this Revision is.
    version: integer().notNull(),
    tripId: uuid()
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    // The whole Expense as the change left it, without its id.
    state: jsonb().$type<ExpenseState>().notNull(),
    deleted: boolean().notNull(),
    // The Participant the device claimed when making the change, if any. Not a reference:
    // it is what the device said, kept as it was.
    claimId: uuid(),
    deviceId: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.expenseId, table.version] }), index().on(table.tripId)],
);

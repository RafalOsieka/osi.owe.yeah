import type { Expense } from '@osi/owe-yeah-domain';
import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { trips } from './trips';

/**
 * An Expense of a Trip. The whole Expense is the unit of change and of Conflict (ADR 0002),
 * so its state is kept as one JSON document and only read back whole. The id is a UUIDv7,
 * normally generated on the client so Expenses can be created offline; Postgres 18's
 * `uuidv7()` fills it in when an insert omits it.
 */
export const expenses = pgTable(
  'expenses',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    tripId: uuid()
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    // Starts at 1 and goes up by one with every accepted change; a change must be based on it.
    version: integer().notNull(),
    // The id of the change that produced this version, so a retried push is recognised.
    lastChangeId: uuid().notNull(),
    // The Expense's state as the domain package validated it, without its id.
    state: jsonb().$type<Omit<Expense, 'id'>>().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    // Bumped by Drizzle on every update made through the schema.
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index().on(table.tripId)],
);

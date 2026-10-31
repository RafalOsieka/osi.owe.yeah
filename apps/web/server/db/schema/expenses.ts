import type { Expense } from '@osi/owe-yeah-domain';
import { index, integer, jsonb, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { trips } from './trips';

/**
 * An Expense of a Trip. The whole Expense is the unit of change and of Conflict (ADR 0002),
 * so its state is kept as one JSON document and only read back whole. The id is a UUIDv7
 * generated on the client, so Expenses can be created offline.
 */
export const expenses = pgTable(
  'expenses',
  {
    id: uuid().primaryKey(),
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

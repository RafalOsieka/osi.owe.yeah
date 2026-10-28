import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { trips } from './trips';

/**
 * A Participant of a Trip. The id is a UUIDv7, normally generated on the client so a
 * retried addition is recognised; Postgres 18's `uuidv7()` fills it in when an insert
 * omits it. Names need not be unique within a Trip.
 */
export const participants = pgTable(
  'participants',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    tripId: uuid()
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    // Bumped by Drizzle on every update made through the schema.
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index().on(table.tripId)],
);

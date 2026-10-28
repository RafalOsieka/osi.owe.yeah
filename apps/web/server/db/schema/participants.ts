import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { trips } from './trips';

/**
 * A Participant of a Trip. The id is a UUIDv7 generated on the client, so a retried
 * addition is recognised. Names need not be unique within a Trip.
 */
export const participants = pgTable(
  'participants',
  {
    id: uuid().primaryKey(),
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

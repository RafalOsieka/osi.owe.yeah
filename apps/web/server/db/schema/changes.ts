import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { trips } from './trips';

/**
 * Every change the push has applied, by the id the device gave it (ADR 0002). A retried
 * change is found here and answered as the first time, so it is never applied twice. Each
 * row also keeps who made the change and where, for display only: the device's Claim at
 * change time and its opaque device id.
 */
export const changes = pgTable(
  'changes',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    tripId: uuid()
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    // The Trip, Participant or Expense the change was to.
    subjectId: uuid().notNull(),
    // The Expense version the change produced; null for Trip and Participant changes.
    version: integer(),
    // The Participant the device claimed when making the change, if any. Not a reference:
    // it is what the device said, kept as it was.
    claimId: uuid(),
    deviceId: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index().on(table.tripId)],
);

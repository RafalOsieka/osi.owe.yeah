import { pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';
import { trips } from './trips';

/**
 * When `from` last reminded `to` in a Trip (#42): one row per pair, so a pair is reminded at
 * most once a day (UTC). Not a Revision, never synced, and keeps no history: a Reminder
 * moves `sentAt` on. The Participants are not references: they are what the device said.
 */
export const reminders = pgTable(
  'reminders',
  {
    tripId: uuid()
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    fromId: uuid().notNull(),
    toId: uuid().notNull(),
    sentAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tripId, table.fromId, table.toId] })],
);

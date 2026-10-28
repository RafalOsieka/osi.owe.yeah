import { char, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * A Trip: the group's shared ledger. The id is generated on the client (UUIDv7),
 * so offline-created Trips keep their id when they sync.
 */
export const trips = pgTable('trips', {
  id: uuid().primaryKey(),
  name: text().notNull(),
  // ISO 4217 code of the Trip currency, in which all balances are kept.
  currency: char({ length: 3 }).notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

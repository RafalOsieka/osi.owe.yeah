import { sql } from 'drizzle-orm';
import { char, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * A Trip: the group's shared ledger. The id is a UUIDv7, normally generated on the
 * client so offline-created Trips keep their id when they sync; Postgres 18's
 * `uuidv7()` fills it in when an insert omits it.
 */
export const trips = pgTable('trips', {
  id: uuid()
    .primaryKey()
    .default(sql`uuidv7()`),
  name: text().notNull(),
  // ISO 4217 code of the Trip currency, in which all balances are kept.
  currency: char({ length: 3 }).notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  // Bumped by Drizzle on every update made through the schema.
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

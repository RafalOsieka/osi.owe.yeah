import { boolean, char, date, numeric, pgTable, primaryKey, timestamp } from 'drizzle-orm/pg-core';

/**
 * The rate table (ADR 0003): how much one unit of `from` is in `to` on a calendar `date`,
 * from Frankfurter's blended mid rates. Filled lazily, when a pull needs an entry. A rate is
 * `fixed` once its date is over everywhere and was published for that very date; from then
 * on it never changes, so old balances never shift. Kept forever.
 */
export const rates = pgTable(
  'rates',
  {
    date: date({ mode: 'string' }).notNull(),
    // ISO 4217 codes: any Expense currency, converted into a Trip currency.
    from: char({ length: 3 }).notNull(),
    to: char({ length: 3 }).notNull(),
    // Exactly as the provider gave it, read back as a plain decimal string.
    rate: numeric().notNull(),
    fixed: boolean().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    // Bumped by Drizzle on every update made through the schema.
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [primaryKey({ columns: [table.date, table.from, table.to] })],
);

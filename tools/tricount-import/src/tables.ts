import type { ExpenseState } from '@osi/owe-yeah-domain';
import { sql } from 'drizzle-orm';
import { boolean, char, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';

/**
 * The importer's own copy of the tables it writes, with only the columns it sets; Postgres
 * fills in the rest from the app's schema (`apps/web/server/db/schema`). Kept apart so the
 * app carries no Tricount code. Drift from the real schema is caught by Postgres refusing the
 * rows and by the balance check, which reads the Expenses back.
 */

export const trips = pgTable('trips', {
  id: uuid()
    .primaryKey()
    .default(sql`uuidv7()`),
  name: text().notNull(),
  currency: char({ length: 3 }).notNull(),
  // SHA-256 (hex) of the Trip link's token; the token itself is only printed (ADR 0001).
  tokenHash: text().notNull().unique(),
});

export const participants = pgTable('participants', {
  id: uuid()
    .primaryKey()
    .default(sql`uuidv7()`),
  tripId: uuid().notNull(),
  name: text().notNull(),
});

export const expenses = pgTable('expenses', {
  id: uuid()
    .primaryKey()
    .default(sql`uuidv7()`),
  tripId: uuid().notNull(),
  version: integer().notNull(),
  state: jsonb().$type<ExpenseState>().notNull(),
});

export const revisions = pgTable('revisions', {
  expenseId: uuid().notNull(),
  version: integer().notNull(),
  tripId: uuid().notNull(),
  state: jsonb().$type<ExpenseState>().notNull(),
  deleted: boolean().notNull(),
  claimId: uuid(),
  deviceId: text().notNull(),
});

import { createHash, randomBytes } from 'node:crypto';
import { expenseSchema, type TripCurrency } from '@osi/owe-yeah-domain';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { balanceMismatches, type BalanceMismatch, type ImportedTrip } from './mapping.ts';
import { expenses, participants, revisions, trips } from './tables.ts';

/** The device id the import's Revisions carry, in place of a phone's. */
const DEVICE_ID = 'tricount-import';

/** Thrown inside the write's transaction when balances don't match, so nothing lands. */
export class BalanceMismatchError extends Error {
  readonly mismatches: BalanceMismatch[];
  /** The Trip currency the balances are in. */
  readonly currency: TripCurrency;

  constructor(mismatches: BalanceMismatch[], currency: TripCurrency) {
    super(`${mismatches.length} balance(s) would differ from Tricount by a cent or more`);
    this.mismatches = mismatches;
    this.currency = currency;
  }
}

/**
 * Writes an imported Trip to `databaseUrl` in one transaction: the Trip under a new Trip
 * link token, its Participants (no Claims), and each Expense at its first version with its
 * Revision. Before committing it reads the Expenses back and aborts on any balance that
 * differs from Tricount's by a cent or more (`balanceMismatches`). Returns the new token.
 */
export async function writeTrip(databaseUrl: string, imported: ImportedTrip): Promise<string> {
  const { trip, tricountBalances } = imported;
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client, { casing: 'snake_case' });
  try {
    await db.transaction(async (tx) => {
      await tx
        .insert(trips)
        .values({ id: trip.id, name: trip.name, currency: trip.currency, tokenHash });
      await tx
        .insert(participants)
        .values(trip.participants.map(({ id, name }) => ({ id, tripId: trip.id, name })));
      const rows = imported.expenses.map(({ id, ...state }) => ({ id, state }));
      if (rows.length > 0) {
        await tx
          .insert(expenses)
          .values(rows.map((row) => ({ ...row, tripId: trip.id, version: 1 })));
        await tx.insert(revisions).values(
          rows.map(({ id, state }) => ({
            expenseId: id,
            version: 1,
            tripId: trip.id,
            state,
            deleted: false,
            claimId: null,
            deviceId: DEVICE_ID,
          })),
        );
      }

      const stored = await tx
        .select({ id: expenses.id, state: expenses.state })
        .from(expenses)
        .where(eq(expenses.tripId, trip.id));
      const readBack = stored.map(({ id, state }) => expenseSchema.parse({ ...state, id }));
      const mismatches = balanceMismatches(trip, readBack, tricountBalances);
      if (mismatches.length > 0) throw new BalanceMismatchError(mismatches, trip.currency);
    });
  } finally {
    await client.end();
  }
  return token;
}

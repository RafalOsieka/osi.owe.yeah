import { z } from 'zod';
import { parseAmount } from './amount.ts';
import { compare, divide, multiply, rational, type Rational } from './rational.ts';

/** A whole, positive number as JSON keeps it exactly. */
const positiveIntSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/**
 * A Line or Receipt discount as entered: an amount in minor units of the Expense currency, or
 * a percentage in basis points (hundredths of a percent, so 12.5 % is 1250). A discount that
 * would take off more than it applies to is a Trip rule broken (`discountExceeds`), so the
 * schema leaves its size open.
 */
export const discountSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('amount'), amount: positiveIntSchema }),
  z.object({ kind: z.literal('percent'), basisPoints: positiveIntSchema }),
]);

export type Discount = z.infer<typeof discountSchema>;

const zero = rational(0n);

/**
 * Reads a percentage as a Participant types it (see `parseAmount`, plus an optional `%`) into
 * basis points, e.g. `12,5` → 1250. Returns `null` for anything that is not positive or is
 * finer than a hundredth of a percent. Over 100 % is read, and refused later as a discount
 * that exceeds what it applies to.
 */
export function parsePercent(text: string): number | null {
  const percent = parseAmount(text.replace('%', ''));
  if (!percent) return null;

  const scaled = percent.numerator * 100n;
  if (scaled % percent.denominator !== 0n) return null;
  const basisPoints = scaled / percent.denominator;
  return basisPoints > 0n && basisPoints <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(basisPoints)
    : null;
}

/** What a discount takes off `base`, both in minor units; nothing without a discount. */
export function takenOff(discount: Discount | undefined, base: Rational): Rational {
  if (!discount) return zero;
  return discount.kind === 'amount'
    ? rational(BigInt(discount.amount))
    : multiply(base, divide(rational(BigInt(discount.basisPoints)), rational(10_000n)));
}

/**
 * Whether a discount takes off more than `base` (minor units), the value it applies to, or
 * applies to money received, which has nothing to discount.
 */
export function discountExceeds(discount: Discount | undefined, base: Rational): boolean {
  if (!discount) return false;
  return base.numerator < 0n || compare(takenOff(discount, base), base) > 0;
}

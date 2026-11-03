import { z } from 'zod';
import { parseAmount } from './amount.ts';
import { minorAmountSchema } from './line-item.ts';
import { rational, type Rational } from './rational.ts';
import { TRIP_CURRENCIES } from './trip.ts';

/** A positive exchange rate as a plain decimal (`0.87593`), so it stays exact in JSON. */
export const rateSchema = z
  .string()
  .max(30)
  .regex(/^\d+(\.\d+)?$/)
  .refine((rate) => /[1-9]/.test(rate), { message: 'A rate is positive' });

/** A plain decimal (`0.87593`) as an exact Rational. */
export function decimal(text: string): Rational {
  const [whole, fraction = ''] = text.split('.');
  return rational(BigInt(whole + fraction), 10n ** BigInt(fraction.length));
}

/**
 * Reads a rate as a Participant types it (see `parseAmount`, e.g. `4,2975`) into the plain
 * decimal it is kept as (`4.2975`). Returns `null` for anything that is not a positive rate.
 */
export function parseRate(text: string): string | null {
  const amount = parseAmount(text);
  if (!amount) return null;
  // The denominator divides a power of ten: `parseAmount` reads decimals.
  let places = 0n;
  while (10n ** places % amount.denominator !== 0n) places++;
  const digits = ((amount.numerator * 10n ** places) / amount.denominator)
    .toString()
    .padStart(Number(places) + 1, '0');
  const point = digits.length - Number(places);
  const typed = places > 0n ? `${digits.slice(0, point)}.${digits.slice(point)}` : digits;
  return rateSchema.safeParse(typed).success ? typed : null;
}

/**
 * A Manual rate, stored as typed: either a `rate` (how much one unit of the Expense currency
 * is in `currency`, e.g. from an exchange office), or the `amount` actually charged in
 * `currency`, in its minor units (e.g. by a card). `currency` is the one it targets, the Trip
 * currency when it was typed; it replaces the automatic rate (ADR 0003).
 */
export const manualRateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('rate'), rate: rateSchema, currency: z.enum(TRIP_CURRENCIES) }),
  z.object({
    kind: z.literal('charged'),
    amount: minorAmountSchema,
    currency: z.enum(TRIP_CURRENCIES),
  }),
]);

export type ManualRate = z.infer<typeof manualRateSchema>;

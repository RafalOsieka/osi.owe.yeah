import { parseAmount } from './amount.ts';
import { rational, roundHalfAwayFromZero, type Rational } from './rational.ts';

/**
 * How many decimal places a currency's amounts have (JPY 0, EUR 2, KWD 3), per the ISO 4217
 * data the runtime's Intl ships. Amounts are entered, stored and shown with exactly these.
 */
export function minorUnits(currency: string): number {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
    .maximumFractionDigits!;
}

/**
 * Reads a positive amount as a Participant types it (see `parseAmount`) into a whole number
 * of the currency's minor units, e.g. `0,29` EUR → 29. Returns `null` for anything that is
 * not positive or has more decimals than the currency allows.
 */
export function parseMoney(text: string, currency: string): number | null {
  const amount = parseAmount(text);
  if (!amount) return null;

  const scaled = amount.numerator * 10n ** BigInt(minorUnits(currency));
  if (scaled % amount.denominator !== 0n) return null;
  const minor = scaled / amount.denominator;
  return minor > 0n && minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
}

/** An exact amount of a currency given in its minor units, e.g. 2450 EUR minor units → 24.5. */
export function fromMinor(minor: number, currency: string): Rational {
  return rational(BigInt(minor), 10n ** BigInt(minorUnits(currency)));
}

/** An amount rounded for display; see `roundMoney`. */
export type RoundedMoney = {
  /** A plain decimal (`-3.33`) that `Intl.NumberFormat` formats without losing precision. */
  decimal: `${number}`;
  /** False when rounding changed the amount, so the UI can mark it with "≈". */
  exact: boolean;
};

/** An exact amount rounded for display to the currency's minor units, halves away from zero. */
export function roundMoney(amount: Rational, currency: string): RoundedMoney {
  const units = minorUnits(currency);
  const scale = 10n ** BigInt(units);
  const minor = roundHalfAwayFromZero(rational(amount.numerator * scale, amount.denominator));

  const digits = (minor < 0n ? -minor : minor).toString().padStart(units + 1, '0');
  const whole = digits.slice(0, digits.length - units);
  const fraction = units > 0 ? `.${digits.slice(-units)}` : '';
  return {
    // SAFETY: an optional minus, digits, and an optional dot with more digits form a number.
    decimal: `${minor < 0n ? '-' : ''}${whole}${fraction}` as `${number}`,
    exact: minor * amount.denominator === amount.numerator * scale,
  };
}

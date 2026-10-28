import { rational } from './rational.ts';
import type { Rational } from './rational.ts';

const IGNORED = /[\s\p{Sc}]/gu;
const DIGITS = /^\d*$/;

/**
 * Parses an amount as a Participant types it: `0,29`, `,29`, `.29`, `1.234,50`, `1 234,50`, `2,5 €`.
 * The last `,` or `.` is always the decimal separator (so `1.234` is 1.234); earlier ones, spaces
 * and currency symbols are ignored. Returns `null` for anything that isn't a non-negative amount.
 * Sign is not typed: Income and refunds are recorded with toggles, not negative numbers.
 */
export function parseAmount(text: string): Rational | null {
  const cleaned = text.replace(IGNORED, '');
  const decimalAt = Math.max(cleaned.lastIndexOf(','), cleaned.lastIndexOf('.'));
  const whole = decimalAt < 0 ? cleaned : cleaned.slice(0, decimalAt).replace(/[.,]/g, '');
  const fraction = decimalAt < 0 ? '' : cleaned.slice(decimalAt + 1);

  if (!DIGITS.test(whole) || !DIGITS.test(fraction) || whole + fraction === '') return null;
  return rational(BigInt(whole + fraction), 10n ** BigInt(fraction.length));
}

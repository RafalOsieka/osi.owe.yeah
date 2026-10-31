import { roundMoney, type Rational } from '@osi/owe-yeah-domain';

/**
 * An exact amount as the UI shows it: rounded to the currency's minor units and formatted
 * for the locale, with "≈ " in front when rounding changed it (e.g. "≈ €3.33").
 */
export function formatMoney(amount: Rational, currency: string, locale: string): string {
  const { decimal, exact } = roundMoney(amount, currency);
  const formatted = new Intl.NumberFormat(locale, { style: 'currency', currency }).format(decimal);
  return exact ? formatted : `≈ ${formatted}`;
}

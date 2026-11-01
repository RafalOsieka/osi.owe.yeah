import { minorUnits, roundMoney, type Rational } from '@osi/owe-yeah-domain';

/**
 * How `formatMoney` writes an amount: with its currency (`€3.33`), with its currency and sign
 * (`+€3.33`), as a bare number in the currency's minor units (`3.33`), or as a bare number
 * with its sign (`+3.33`, `-3.33`).
 */
export type MoneyDisplay = 'currency' | 'signedCurrency' | 'number' | 'signed';

/**
 * The sign of an amount as the UI shows it, rounded to the currency's minor units: a
 * fraction of a cent left over by an Even split is 0, not owing or owed.
 */
export function shownSign(amount: Rational, currency: string): -1 | 0 | 1 {
  const shown = Number(roundMoney(amount, currency).decimal);
  return shown > 0 ? 1 : shown < 0 ? -1 : 0;
}

/**
 * An exact amount as the UI shows it: rounded to the currency's minor units and formatted
 * for the locale, with "≈ " in front when rounding changed it (e.g. "≈ €3.33").
 */
export function formatMoney(
  amount: Rational,
  currency: string,
  locale: string,
  display: MoneyDisplay = 'currency',
): string {
  const { decimal, exact } = roundMoney(amount, currency);
  const digits = minorUnits(currency);
  const signDisplay = display === 'signed' || display === 'signedCurrency' ? 'exceptZero' : 'auto';
  const format =
    display === 'currency' || display === 'signedCurrency'
      ? new Intl.NumberFormat(locale, { style: 'currency', currency, signDisplay })
      : new Intl.NumberFormat(locale, {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
          signDisplay,
        });
  const formatted = format.format(decimal);
  return exact ? formatted : `≈ ${formatted}`;
}

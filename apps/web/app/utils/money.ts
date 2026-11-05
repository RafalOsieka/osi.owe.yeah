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
 * for the locale, with "≈ " in front when rounding changed it (e.g. "≈ €3.33"), or when it is
 * `approximate` anyway, e.g. converted at a Provisional rate. Negative amounts take a true
 * minus sign ("−€1.00"), as wide as the plus.
 */
export function formatMoney(
  amount: Rational,
  currency: string,
  locale: string,
  display: MoneyDisplay = 'currency',
  approximate = false,
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
  const formatted = format.format(decimal).replace('-', '\u2212');
  return exact && !approximate ? formatted : `≈ ${formatted}`;
}

/** An exchange rate as the UI shows it, to six significant digits (e.g. "4.24835"). */
export function formatRate(rate: Rational, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumSignificantDigits: 6 }).format(
    Number(rate.numerator) / Number(rate.denominator),
  );
}

/**
 * How `formatMoney` marks a currency in `locale`, and whether it comes before the number: "€"
 * before in English, after in Polish; "HUF" where the locale has no symbol of its own. Money
 * inputs show it the same way, so a form writes every amount alike.
 */
export function currencySymbol(currency: string, locale: string) {
  const parts = new Intl.NumberFormat(locale, { style: 'currency', currency }).formatToParts(1);
  const at = (type: Intl.NumberFormatPartTypes) => parts.findIndex((part) => part.type === type);
  return { text: parts[at('currency')]?.value ?? currency, before: at('currency') < at('integer') };
}

/**
 * An exchange rate the readable way round: one of the stronger currency in the weaker, to five
 * significant digits, e.g. "1 EUR ≈ 397.52 HUF" for a `rate` of HUF in EUR (1 `from` = `rate`
 * `to`).
 */
export function readableRate(rate: Rational, from: string, to: string, locale: string): string {
  const value = Number(rate.numerator) / Number(rate.denominator);
  const format = new Intl.NumberFormat(locale, { maximumSignificantDigits: 5 });
  return value >= 1
    ? `1 ${from} ≈ ${format.format(value)} ${to}`
    : `1 ${to} ≈ ${format.format(1 / value)} ${from}`;
}

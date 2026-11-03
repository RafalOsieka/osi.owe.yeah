import {
  fromMinor,
  parseMoney,
  parseRate,
  roundMoney,
  type Currency,
  type ManualRate,
  type TripCurrency,
} from '@osi/owe-yeah-domain';

/**
 * A Manual rate as the Expense and Repayment forms edit it: a rate or the amount charged, as
 * typed, and the currency it targets. Left empty, there is none; switching the kind keeps
 * what was typed.
 */
export type DraftManualRate = { kind: ManualRate['kind']; value: string; currency: TripCurrency };

/** A saved Manual rate as typed, or an empty one targeting the Trip currency. */
export function draftFromManualRate(
  manualRate: ManualRate | undefined,
  tripCurrency: TripCurrency,
): DraftManualRate {
  if (!manualRate) return { kind: 'charged', value: '', currency: tripCurrency };
  const { kind, currency } = manualRate;
  return kind === 'rate'
    ? { kind, currency, value: manualRate.rate }
    : {
        kind,
        currency,
        value: roundMoney(fromMinor(manualRate.amount, currency), currency).decimal,
      };
}

/**
 * The Manual rate to save with an Expense in `currency`: as `manualRateFromDraft`, but none
 * while it targets that currency itself, as it does once the Expense is put in the Trip
 * currency (`ExpenseCurrency` points it there).
 */
export function manualRateToSave(
  draft: DraftManualRate,
  currency: Currency,
): ManualRate | undefined | null {
  return draft.currency === currency ? undefined : manualRateFromDraft(draft);
}

/**
 * The Manual rate a draft makes: `undefined` when none is typed, `null` while it cannot be
 * read (`parseRate`, or `parseMoney` in the currency it targets).
 */
export function manualRateFromDraft(draft: DraftManualRate): ManualRate | undefined | null {
  if (draft.value.trim() === '') return undefined;
  const { currency } = draft;
  if (draft.kind === 'rate') {
    const rate = parseRate(draft.value);
    return rate === null ? null : { kind: 'rate', rate, currency };
  }
  const amount = parseMoney(draft.value, currency);
  return amount === null ? null : { kind: 'charged', amount, currency };
}

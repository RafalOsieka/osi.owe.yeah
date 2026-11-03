import { minorUnits, type Currency, type Rational } from '@osi/owe-yeah-domain';
import type { FormError } from '@nuxt/ui';
import { manualRateToSave, type DraftManualRate } from '~/utils/manual-rate-draft';

/**
 * Why the Manual rate typed for an Expense in `currency` with `total` can't be saved, as
 * errors for the form's `manualRate` field (`ExpenseCurrency`): it can't be read, or it is an
 * amount charged for a total of zero, which no rate makes.
 */
export function useManualRateErrors() {
  const { t } = useI18n();
  return (draft: DraftManualRate, currency: Currency, total: Rational | null): FormError[] => {
    const typed = manualRateToSave(draft, currency);
    if (typed === null) {
      const decimals = minorUnits(draft.currency);
      const message =
        draft.kind === 'rate'
          ? t('rate.rateInvalid')
          : t('expense.amountInvalid', { decimals }, decimals);
      return [{ name: 'manualRate', message }];
    }
    if (typed?.kind === 'charged' && total?.numerator === 0n) {
      return [{ name: 'manualRate', message: t('rate.chargedWithoutTotal') }];
    }
    return [];
  };
}

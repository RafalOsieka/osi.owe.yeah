import { minorUnits, type ExpenseProblem } from '@osi/owe-yeah-domain';
import type { FormError } from '@nuxt/ui';
import {
  isProblem,
  type DraftField,
  type DraftReason,
  type ExpenseDraft,
  type LineItemReason,
} from '~/utils/expense-draft';

/**
 * Words the reasons an Expense draft can't be saved (`readDraft`, `readLineItem`), with the
 * messages the forms have always shown: the Trip rules a draft would break mostly as the
 * device and server word a refused save (`expense.refused`).
 */
export function useDraftReasons() {
  const { t } = useI18n();

  const amountInvalid = (currency: string) => {
    const decimals = minorUnits(currency);
    return t('expense.amountInvalid', { decimals }, decimals);
  };

  function unreadMessage(
    field: DraftField,
    code: DraftReason['code'],
    draft: ExpenseDraft,
  ): string {
    switch (field) {
      // An empty field asks for what is missing; the limits show once something breaks them.
      case 'title':
        return code === 'missing' ? t('expense.titleMissing') : t('expense.titleInvalid');
      case 'amount':
        return code === 'missing' ? t('expense.amountMissing') : amountInvalid(draft.currency);
      case 'manualRate':
        return draft.manualRate.kind === 'rate'
          ? t('rate.rateInvalid')
          : amountInvalid(draft.manualRate.currency);
      case 'mainPayerId':
        return draft.kind === 'split' && draft.received
          ? t('expense.receiverMissing')
          : t('expense.payerMissing');
      case 'recipientId':
        return t('repayment.recipientMissing');
      case 'participantIds':
        return t('expense.participantsMissing');
      case 'local':
        return t('expense.timeMissing');
      case 'lineItems':
        return code === 'missing'
          ? t('receipt.lineItemsMissing')
          : t('receipt.lineItemsUnreadable');
      case 'discount':
        return t('receipt.discountUnreadable');
      case 'contributions':
        return t('contribution.unreadable');
    }
  }

  function problem(code: ExpenseProblem): string {
    switch (code) {
      case 'repaymentToSelf':
        return t('repayment.sameParticipant');
      case 'receiptDiscountExceedsLineItems':
        return t('receipt.receiptDiscountExceeds');
      case 'contributionsExceedTotal':
        return t('contribution.exceeds');
      case 'chargedWithoutTotal':
        return t('rate.chargedWithoutTotal');
      default:
        return t(`expense.refused.${code}`);
    }
  }

  /** Why a field of `draft` keeps it from being saved. */
  function draftReason(reason: DraftReason, draft: ExpenseDraft): string {
    return isProblem(reason)
      ? problem(reason.code)
      : unreadMessage(reason.field, reason.code, draft);
  }

  /** What a Line item says it can't read. */
  function lineItemReason({ field }: LineItemReason): string {
    switch (field) {
      case 'price':
        return t('receipt.checkPrice');
      case 'amount':
        return t('receipt.checkAmount');
      case 'discount':
        return t('receipt.discountUnreadable');
      case 'deposit':
        return t('receipt.depositUnreadable');
      case 'amounts':
        return t('receipt.amountsUnreadable');
    }
  }

  /** A draft's reasons as its form's errors, by field name, each message once. */
  function formErrors(reasons: readonly DraftReason[], draft: ExpenseDraft): FormError[] {
    const errors = reasons.map((reason) => ({
      name: reason.field,
      message: draftReason(reason, draft),
    }));
    return errors.filter(
      (error, index) =>
        errors.findIndex(
          ({ name, message }) => name === error.name && message === error.message,
        ) === index,
    );
  }

  /**
   * The Trip rule a draft would break at `field`, in words, shown while the form is filled
   * in rather than once the field is checked; `undefined` when none.
   */
  function problemAt(reasons: readonly DraftReason[], field: DraftField): string | undefined {
    const found = reasons.filter(isProblem).find((reason) => reason.field === field);
    return found && problem(found.code);
  }

  return { draftReason, lineItemReason, formErrors, problemAt };
}

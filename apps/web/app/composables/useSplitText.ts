import {
  fromMinor,
  negate,
  parseMoney,
  splitParticipantIds,
  type Discount,
  type LineItem,
  type LineItemShares,
  type Participant,
  type Rational,
} from '@osi/owe-yeah-domain';
import type { DraftSplit } from '~/utils/expense-draft';

/**
 * How a Line item's split reads in one line: its Split mode and who it names, with their
 * units for Units ("Units · Ania 2, Kasia 1") and, given the `currency`, their amounts for
 * Amounts ("Amounts · Kasia €10.00, Marta €4.50"), "all N" when Even names everyone, or that
 * nobody has been given any of it yet. A saved split goes through `draftSplit` first.
 */
export function useSplitText() {
  const { t, locale } = useI18n();

  return (split: DraftSplit, participants: readonly Participant[], currency?: string): string => {
    const nameOf = (id: string) =>
      participants.find((participant) => participant.id === id)?.name ?? '?';
    const ids =
      split.mode === 'amounts'
        ? split.parts.flatMap(({ participantId, amount }) =>
            // An Amount left empty is nobody's yet.
            amount.trim() === '' ? [] : [participantId],
          )
        : splitParticipantIds(split);
    const mode = t(`receipt.mode.${split.mode}`);
    if (ids.length === 0) return `${mode} · ${t('receipt.nobodyYet')}`;
    if (split.mode === 'even' && ids.length === participants.length) {
      return `${mode} · ${t('expense.forAll', { count: ids.length })}`;
    }
    const names =
      split.mode === 'units'
        ? split.parts.map(({ participantId, units }) => `${nameOf(participantId)} ${units}`)
        : split.mode === 'amounts' && currency
          ? split.parts.flatMap(({ participantId, amount }) => {
              // An Amount is as typed; one that can't be read shows that way.
              if (amount.trim() === '') return [];
              const minor = parseMoney(amount, currency);
              const shown =
                minor === null
                  ? amount
                  : formatMoney(fromMinor(minor, currency), currency, locale.value);
              return [`${nameOf(participantId)} ${shown}`];
            })
          : ids.map(nameOf);
    return `${mode} · ${new Intl.ListFormat(locale.value, { style: 'narrow' }).format(names)}`;
  };
}

/**
 * What of a Line item is not assigned yet, said once, as the Receipt's detail page says it:
 * the units for a Units split ("1 of 4 units unassigned"), the amount otherwise; `null` once
 * all of it is.
 */
export function useUnassignedText() {
  const { t, locale } = useI18n();

  return (item: LineItem, shares: LineItemShares, currency: string): string | null => {
    if (shares.unassigned.numerator === 0n) return null;
    if (item.split.mode !== 'units') {
      return t('receipt.notAssigned', {
        amount: formatMoney(shares.unassigned, currency, locale.value),
      });
    }
    const assigned = item.split.parts.reduce((sum, { units }) => sum + units, 0);
    return t('receipt.unitsUnassigned', {
      unassigned: item.quantity - assigned,
      quantity: item.quantity,
    });
  };
}

/**
 * A discount as the Receipt reads it, on its form as on its detail page: "25% off · −€1.49",
 * or "−€1.00" for an amount; `asLine` says it as a Line item's fact ("Discount −€1.00
 * included", "25% off · −€1.49, included").
 */
export function useDiscountText() {
  const { t, locale } = useI18n();

  return (discount: Discount, off: Rational, currency: string, asLine = false): string => {
    const amount = formatMoney(negate(off), currency, locale.value);
    if (discount.kind === 'amount') {
      return asLine ? t('receipt.lineDiscountAmount', { amount }) : amount;
    }
    const percent = new Intl.NumberFormat(locale.value, {
      style: 'percent',
      maximumFractionDigits: 2,
    }).format(discount.basisPoints / 10_000);
    const text = t('receipt.percentOff', { percent, amount });
    return asLine ? t('receipt.lineDiscountPercent', { discount: text }) : text;
  };
}

import {
  fromMinor,
  lineItemShares,
  negate,
  parseMoney,
  splitParticipantIds,
  spread,
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
 * Amounts ("Amounts · Kasia €10.00, Marta €4.50"), "all N" when Even names exactly the Trip's
 * current `participants`, or that nobody has been given any of it yet. A saved split goes
 * through `draftSplit` first. Names come from `everyone` the Trip has had when given, so a
 * removed Participant on an older Revision is still named. Typed amounts weigh against the full
 * price, so given the Line `item` with a Line discount, Amounts shows what each Participant's
 * part of the line comes to after it ("Amounts after the Line discount · Kasia €7.50"), without
 * the Deposit, which the line says on its own.
 */
export function useSplitText() {
  const { t, locale } = useI18n();

  return (
    split: DraftSplit,
    participants: readonly Participant[],
    {
      currency,
      item,
      everyone = participants,
    }: { currency?: string; item?: LineItem | null; everyone?: readonly Participant[] } = {},
  ): string => {
    const nameOf = (id: string) =>
      everyone.find((participant) => participant.id === id)?.name ?? '?';
    const ids =
      split.mode === 'amounts'
        ? split.parts.flatMap(({ participantId, amount }) =>
            // An Amount left empty is nobody's yet.
            amount.trim() === '' ? [] : [participantId],
          )
        : splitParticipantIds(split);
    // Each Share of the line after its Line discount, when an Amounts split has one.
    const discountedShares =
      split.mode === 'amounts' && currency && item?.discount && item.split.mode === 'amounts'
        ? spread(item, lineItemShares(item, currency).net).shares
        : null;
    const mode = discountedShares
      ? t('receipt.amountsAfterLineDiscount')
      : t(`receipt.mode.${split.mode}`);
    if (ids.length === 0) return `${mode} · ${t('receipt.nobodyYet')}`;
    if (
      split.mode === 'even' &&
      ids.length === participants.length &&
      participants.every(({ id }) => ids.includes(id))
    ) {
      return `${mode} · ${t('expense.forAll', { count: ids.length })}`;
    }
    const names =
      split.mode === 'units'
        ? split.parts.map(({ participantId, units }) => `${nameOf(participantId)} ${units}`)
        : discountedShares && currency
          ? [...discountedShares].map(
              ([id, share]) => `${nameOf(id)} ${formatMoney(share, currency, locale.value)}`,
            )
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
 * What of a Line item is not assigned yet, as the Receipt's form and detail page say it on the
 * line: the units for a Units split ("1 of 4 units unassigned"), the amount otherwise; `null`
 * once all of it is. With `withValue`, the units are followed by what they come to, and
 * `after`, when given, by what the line's unassigned value comes to after the Receipt
 * discount, so the lines add up to the Main payer's share ("1 of 4 units unassigned · ≈ €1.12
 * (≈ €1.06 after the Receipt discount)").
 */
export function useUnassignedText() {
  const { t, locale } = useI18n();

  return (
    item: LineItem,
    shares: LineItemShares,
    currency: string,
    { withValue = false, after = null }: { withValue?: boolean; after?: Rational | null } = {},
  ): string | null => {
    if (shares.unassigned.numerator === 0n) return null;
    const money = (amount: Rational) => formatMoney(amount, currency, locale.value);
    const discounted = after && t('receipt.afterReceiptDiscount', { amount: money(after) });
    if (shares.unassignedUnits === undefined) {
      const text = t('receipt.notAssigned', { amount: money(shares.unassigned) });
      return discounted ? `${text} (${discounted})` : text;
    }
    const text = t('receipt.unitsUnassigned', {
      unassigned: shares.unassignedUnits,
      quantity: item.quantity,
    });
    if (!withValue) return text;
    const value = money(shares.unassigned);
    return `${text} · ${discounted ? `${value} (${discounted})` : value}`;
  };
}

/**
 * What of a Receipt is not assigned yet, as its form and detail page head it: in units while
 * every Line item with unassigned value is split by Units ("1 unit unassigned"), the amount
 * otherwise, and whose it is for now: the Main `payer`'s ("Kasia's for now", or "yours" when
 * `yours`). `inUnits` says which, so the form can show the value under it. `null` while
 * every Line item is assigned in full.
 */
export function useUnassignedHeadline() {
  const { t, locale } = useI18n();

  return ({
    lineItems,
    unassigned,
    currency,
    payer,
    yours,
  }: {
    lineItems: readonly LineItemShares[];
    unassigned: Rational;
    currency: string;
    payer: Participant | undefined;
    yours: boolean;
  }): { text: string; inUnits: boolean } | null => {
    const open = lineItems.filter((shares) => shares.unassigned.numerator !== 0n);
    if (open.length === 0) return null;
    const units = open.map(({ unassignedUnits }) => unassignedUnits);
    const inUnits = units.every((count) => count !== undefined);
    const what = inUnits
      ? t(
          'receipt.unitsUnassignedTotal',
          units.reduce<number>((sum, count) => sum + (count ?? 0), 0),
        )
      : t('receipt.amountUnassigned', { amount: formatMoney(unassigned, currency, locale.value) });
    const whose = yours
      ? t('receipt.countedAsYours')
      : t('receipt.countedAs', { name: payer?.name ?? '?' });
    return { text: `${what} · ${whose}`, inUnits };
  };
}

/**
 * A Line item's name as the Receipt shows it: its own, or for one without a name "Deposit
 * refund" when it is one, else "Line item 3" by its `position` on the Receipt, from 1.
 */
export function useLineItemName() {
  const { t } = useI18n();

  return ({ name, refund }: { name: string; refund: boolean }, position: number): string =>
    name.trim() || (refund ? t('receipt.depositRefund') : t('receipt.unnamed', { position }));
}

/**
 * A discount as the Receipt reads it, on its form as on its detail page: "25% off · −€1.49",
 * or "−€1.00" for an amount, as a summary row's value; `asLine` says it as a Line item's fact,
 * one shape for both kinds: what is off, then that it is included ("€1.00 off, included",
 * "25% off · −€1.49, included").
 */
export function useDiscountText() {
  const { t, locale } = useI18n();

  return (discount: Discount, off: Rational, currency: string, asLine = false): string => {
    const amount = formatMoney(negate(off), currency, locale.value);
    if (discount.kind === 'amount') {
      if (!asLine) return amount;
      const what = t('receipt.amountOff', { amount: formatMoney(off, currency, locale.value) });
      return t('receipt.discountIncluded', { discount: what });
    }
    const percent = new Intl.NumberFormat(locale.value, {
      style: 'percent',
      maximumFractionDigits: 2,
    }).format(discount.basisPoints / 10_000);
    const text = t('receipt.percentOff', { percent, amount });
    return asLine ? t('receipt.discountIncluded', { discount: text }) : text;
  };
}

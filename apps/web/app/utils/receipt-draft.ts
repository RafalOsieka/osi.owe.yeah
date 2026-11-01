import {
  fromMinor,
  parseMoney,
  parsePercent,
  roundMoney,
  type Discount,
  type LineItem,
  type Split,
} from '@osi/owe-yeah-domain';
import { v7 as uuidv7 } from 'uuid';

/** A split as the Till list edits it: Amounts are kept as typed until the Receipt is saved. */
export type DraftSplit =
  | Exclude<Split, { mode: 'amounts' }>
  | { mode: 'amounts'; parts: { participantId: string; amount: string }[] };

/**
 * A Line or Receipt discount as typed: an amount in the currency or a percentage. Left empty,
 * there is none; switching the kind keeps what was typed.
 */
export type DraftDiscount = { kind: Discount['kind']; value: string };

/** A Line item as the Till list edits it, with its price as typed. */
export type DraftLineItem = {
  /** Keeps the line's place in the list while it is edited and moved; never saved. */
  key: string;
  name: string;
  price: string;
  quantity: number;
  discount: DraftDiscount;
  split: DraftSplit;
};

/** No discount typed yet; it starts as an amount. */
export const noDiscount = (): DraftDiscount => ({ kind: 'amount', value: '' });

/** A new draft Line item; without a Line discount unless one is given. */
export function draftLineItem(
  fields: Pick<DraftLineItem, 'name' | 'price' | 'quantity' | 'split'> &
    Partial<Pick<DraftLineItem, 'discount'>>,
): DraftLineItem {
  return { key: uuidv7(), discount: noDiscount(), ...fields };
}

const typed = (minor: number, currency: string) =>
  roundMoney(fromMinor(minor, currency), currency).decimal;

/** A saved discount as typed, or none. */
export function draftFromDiscount(discount: Discount | undefined, currency: string): DraftDiscount {
  if (!discount) return noDiscount();
  return discount.kind === 'amount'
    ? { kind: 'amount', value: typed(discount.amount, currency) }
    : { kind: 'percent', value: String(discount.basisPoints / 100) };
}

/**
 * The discount a draft makes: `undefined` when none is typed, `null` while it cannot be read
 * (`parseMoney`, `parsePercent`).
 */
export function discountFromDraft(
  draft: DraftDiscount,
  currency: string,
): Discount | undefined | null {
  if (draft.value.trim() === '') return undefined;
  if (draft.kind === 'amount') {
    const amount = parseMoney(draft.value, currency);
    return amount === null ? null : { kind: 'amount', amount };
  }
  const basisPoints = parsePercent(draft.value);
  return basisPoints === null ? null : { kind: 'percent', basisPoints };
}

/** A saved Line item as the Till list edits it. */
export function draftFromLineItem(item: LineItem, currency: string): DraftLineItem {
  const { split } = item;
  return draftLineItem({
    name: item.name,
    price: typed(Math.abs(item.unitPrice), currency),
    quantity: item.quantity,
    split:
      split.mode === 'amounts'
        ? {
            mode: 'amounts',
            parts: split.parts.map(({ participantId, amount }) => ({
              participantId,
              amount: typed(amount, currency),
            })),
          }
        : split,
    discount: draftFromDiscount(item.discount, currency),
  });
}

/**
 * The Line item a draft makes, or `null` while its price, its Line discount or one of its
 * Amounts cannot be read. Amounts left empty are nobody's yet. Built afresh, so it holds none
 * of the form's reactive proxies, which the device store cannot keep.
 */
export function lineItemFromDraft(draft: DraftLineItem, currency: string): LineItem | null {
  const unitPrice = parseMoney(draft.price, currency);
  const discount = discountFromDraft(draft.discount, currency);
  if (unitPrice === null || discount === null) return null;
  const { split } = draft;
  const line = {
    name: draft.name.trim(),
    unitPrice,
    quantity: draft.quantity,
    // Left out when there is none, as the device store and the server keep it.
    ...(discount && { discount }),
  };
  if (split.mode === 'even') {
    return { ...line, split: { mode: 'even', participantIds: [...split.participantIds] } };
  }
  if (split.mode === 'units') {
    return { ...line, split: { mode: 'units', parts: split.parts.map((part) => ({ ...part })) } };
  }

  const parts: { participantId: string; amount: number }[] = [];
  for (const { participantId, amount } of split.parts) {
    if (amount.trim() === '') continue;
    const minor = parseMoney(amount, currency);
    if (minor === null) return null;
    parts.push({ participantId, amount: minor });
  }
  return { ...line, split: { mode: 'amounts', parts } };
}

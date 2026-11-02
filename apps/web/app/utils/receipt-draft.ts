import {
  fromMinor,
  isDepositRefund,
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

/**
 * A Line item as the Till list edits it, with its price as typed. A Deposit refund keeps its
 * amount in `price`, typed without a minus, and has no quantity, discount or Deposit.
 */
export type DraftLineItem = {
  /** Keeps the line's place in the list while it is edited and moved; never saved. */
  key: string;
  name: string;
  price: string;
  quantity: number;
  discount: DraftDiscount;
  /** The Deposit per unit as typed; empty for none. */
  deposit: string;
  /** A Deposit refund: money received back, saved as a negative Line item. */
  refund: boolean;
  split: DraftSplit;
};

/** No discount typed yet; it starts as an amount. */
export const noDiscount = (): DraftDiscount => ({ kind: 'amount', value: '' });

/**
 * A new draft Line item; goods without a Line discount or a Deposit unless they are given.
 */
export function draftLineItem(
  fields: Pick<DraftLineItem, 'name' | 'price' | 'quantity' | 'split'> &
    Partial<Pick<DraftLineItem, 'discount' | 'deposit' | 'refund'>>,
): DraftLineItem {
  return { key: uuidv7(), discount: noDiscount(), deposit: '', refund: false, ...fields };
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

/**
 * The Deposit per unit a draft makes, in minor units: `undefined` when none is typed, `null`
 * while it cannot be read (`parseMoney`).
 */
export function depositFromDraft(deposit: string, currency: string): number | undefined | null {
  return deposit.trim() === '' ? undefined : parseMoney(deposit, currency);
}

/** A saved Line item as the Till list edits it. */
export function draftFromLineItem(item: LineItem, currency: string): DraftLineItem {
  const { split } = item;
  return draftLineItem({
    name: item.name,
    price: typed(Math.abs(item.unitPrice), currency),
    quantity: item.quantity,
    refund: isDepositRefund(item),
    deposit: item.depositPerUnit ? typed(item.depositPerUnit, currency) : '',
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
 * A draft's Line item without its split, or `null` while its price, its Line discount or its
 * Deposit cannot be read. A Deposit refund is one negative unit, whatever else the draft holds.
 */
function pricedFromDraft(draft: DraftLineItem, currency: string): Omit<LineItem, 'split'> | null {
  const price = parseMoney(draft.price, currency);
  if (price === null) return null;
  const name = draft.name.trim();
  if (draft.refund) return { name, unitPrice: -price, quantity: 1 };

  const discount = discountFromDraft(draft.discount, currency);
  const depositPerUnit = depositFromDraft(draft.deposit, currency);
  if (discount === null || depositPerUnit === null) return null;
  return {
    name,
    unitPrice: price,
    quantity: draft.quantity,
    // Left out when there is none, as the device store and the server keep them.
    ...(discount && { discount }),
    ...(depositPerUnit && { depositPerUnit }),
  };
}

/**
 * The Line item a draft makes, or `null` while its price, its Line discount, its Deposit or
 * one of its Amounts cannot be read (`pricedFromDraft`). Amounts left empty are nobody's yet.
 * Built afresh, so it holds none of the form's reactive proxies, which the device store
 * cannot keep.
 */
export function lineItemFromDraft(draft: DraftLineItem, currency: string): LineItem | null {
  const line = pricedFromDraft(draft, currency);
  if (!line) return null;
  const { split } = draft;
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

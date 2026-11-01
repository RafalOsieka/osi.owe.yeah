import { fromMinor, parseMoney, roundMoney, type LineItem, type Split } from '@osi/owe-yeah-domain';
import { v7 as uuidv7 } from 'uuid';

/** A split as the Till list edits it: Amounts are kept as typed until the Receipt is saved. */
export type DraftSplit =
  | Exclude<Split, { mode: 'amounts' }>
  | { mode: 'amounts'; parts: { participantId: string; amount: string }[] };

/** A Line item as the Till list edits it, with its price as typed. */
export type DraftLineItem = {
  /** Keeps the line's place in the list while it is edited and moved; never saved. */
  key: string;
  name: string;
  price: string;
  quantity: number;
  split: DraftSplit;
};

/** A new draft Line item. */
export function draftLineItem(
  fields: Pick<DraftLineItem, 'name' | 'price' | 'quantity' | 'split'>,
): DraftLineItem {
  return { key: uuidv7(), ...fields };
}

const typed = (minor: number, currency: string) =>
  roundMoney(fromMinor(minor, currency), currency).decimal;

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
  });
}

/**
 * The Line item a draft makes, or `null` while its price or one of its Amounts cannot be read
 * (`parseMoney`). Amounts left empty are nobody's yet. Built afresh, so it holds none of the
 * form's reactive proxies, which the device store cannot keep.
 */
export function lineItemFromDraft(draft: DraftLineItem, currency: string): LineItem | null {
  const unitPrice = parseMoney(draft.price, currency);
  if (unitPrice === null) return null;
  const { split } = draft;
  const line = { name: draft.name.trim(), unitPrice, quantity: draft.quantity };
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

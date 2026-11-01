import { z } from 'zod';
import { discountExceeds, discountSchema, takenOff } from './discount.ts';
import { participantIdSchema } from './participant.ts';
import { add, rational, subtract, type Rational } from './rational.ts';

/** An amount in whole minor units of its currency (cents for EUR), so it stays exact in JSON. */
export const minorAmountSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/** The most units a Line item may have, or a Participant may take of it. */
export const MAX_UNITS = 10_000;

/** How many units a Line item has, or a Participant takes of it: a whole number, at least 1. */
const unitsSchema = z.number().int().min(1).max(MAX_UNITS);

const distinct = (ids: readonly string[]) => new Set(ids).size === ids.length;
const onlyOnce = { message: 'A Participant can be in a split only once' };

/** Even: equal parts for every ticked Participant. Nobody ticked leaves the line unassigned. */
const evenSplitSchema = z.object({
  mode: z.literal('even'),
  participantIds: z.array(participantIdSchema).max(100).refine(distinct, onlyOnce),
});

/** Units: whole units per Participant, adding up to at most the quantity; the rest is unassigned. */
const unitsSplitSchema = z.object({
  mode: z.literal('units'),
  parts: z
    .array(z.object({ participantId: participantIdSchema, units: unitsSchema }))
    .max(100)
    .refine((parts) => distinct(parts.map(({ participantId }) => participantId)), onlyOnce),
});

/**
 * Amounts: exact amounts per Participant in minor units, adding up to at most the full-price
 * Line total; the rest is unassigned.
 */
const amountsSplitSchema = z.object({
  mode: z.literal('amounts'),
  parts: z
    .array(z.object({ participantId: participantIdSchema, amount: minorAmountSchema }))
    .max(100)
    .refine((parts) => distinct(parts.map(({ participantId }) => participantId)), onlyOnce),
});

/** How a Line item is divided: its Split mode and that mode's inputs, stored as entered. */
export const splitSchema = z.discriminatedUnion('mode', [
  evenSplitSchema,
  unitsSplitSchema,
  amountsSplitSchema,
]);

export type Split = z.infer<typeof splitSchema>;
export type SplitMode = Split['mode'];
type EvenSplit = Extract<Split, { mode: 'even' }>;

/**
 * One position of an Expense: a name (empty on a plain Expense), a unit price and a whole
 * quantity, so "6 × water" is one line and weighed goods are one unit at the line price, and
 * an optional Line discount, which a per-unit discount is entered as in full (2 × 0.20 off is
 * 0.40 off). A negative unit price is money received, which makes a plain Expense Income; it
 * is never zero. Name and quantity default for Expenses saved before Receipts existed.
 */
export const lineItemSchema = z.object({
  name: z.string().trim().max(100).default(''),
  unitPrice: z
    .number()
    .int()
    .min(-Number.MAX_SAFE_INTEGER)
    .max(Number.MAX_SAFE_INTEGER)
    .refine((price) => price !== 0, { message: 'A Line item is never zero' }),
  quantity: unitsSchema.default(1),
  discount: discountSchema.optional(),
  split: splitSchema,
});

export type LineItem = z.infer<typeof lineItemSchema>;

/** The Participants a split names, in the order it names them. */
export function splitParticipantIds(split: Split): string[] {
  return split.mode === 'even'
    ? [...split.participantIds]
    : split.parts.map(({ participantId }) => participantId);
}

/** A Line item's full-price total in minor units: unit price × quantity. */
export function lineTotalMinor({ unitPrice, quantity }: LineItem): bigint {
  return BigInt(unitPrice) * BigInt(quantity);
}

/**
 * A Line item's total after its Line discount, in minor units: what its split shares, and
 * what the Receipt discount applies to.
 */
export function lineNetMinor(item: LineItem): Rational {
  const total = rational(lineTotalMinor(item));
  return subtract(total, takenOff(item.discount, total));
}

/**
 * What a Receipt's Line items come to after their Line discounts, in minor units: what the
 * Receipt discount applies to.
 */
export function goodsMinor(lineItems: readonly LineItem[]): Rational {
  return lineItems.reduce((sum, item) => add(sum, lineNetMinor(item)), rational(0n));
}

/**
 * What the split engine sees of a Line item: a whole-number weight per Participant, and the
 * weight nobody has been given yet. The line is shared in proportion to them; the total
 * weight is never zero.
 */
export type SplitWeights = {
  weights: ReadonlyMap<string, bigint>;
  rest: bigint;
};

/**
 * A Line item's split reduced to weights (`SplitWeights`): Even weighs 1 per ticked
 * Participant (the whole line is the rest when nobody is ticked), Units the unit count,
 * Amounts the amount.
 */
export function splitWeights(item: LineItem): SplitWeights {
  const { split } = item;
  if (split.mode === 'even') {
    return {
      weights: new Map(split.participantIds.map((id) => [id, 1n])),
      rest: split.participantIds.length > 0 ? 0n : 1n,
    };
  }
  const [parts, whole] =
    split.mode === 'units'
      ? [
          split.parts.map((part) => [part.participantId, BigInt(part.units)] as const),
          BigInt(item.quantity),
        ]
      : [
          split.parts.map((part) => [part.participantId, BigInt(part.amount)] as const),
          abs(lineTotalMinor(item)),
        ];
  const assigned = parts.reduce((sum, [, weight]) => sum + weight, 0n);
  return { weights: new Map(parts), rest: assigned < whole ? whole - assigned : 0n };
}

const abs = (value: bigint) => (value < 0n ? -value : value);

/** Why a Line item does not fit together: its split, or its Line discount. */
export const LINE_ITEM_PROBLEMS = [
  'unitsExceedQuantity',
  'amountsExceedLineTotal',
  'lineDiscountExceedsLineTotal',
] as const;

export type LineItemProblem = (typeof LINE_ITEM_PROBLEMS)[number];

/**
 * Why a Line item does not fit together; empty when it does. Units may not add up to more
 * than the quantity, and Amounts not to more than the full-price Line total; adding up to
 * less is allowed, the rest is unassigned. The Line discount may not take off more than the
 * full-price Line total.
 */
export function lineItemProblems(item: LineItem): LineItemProblem[] {
  const { split } = item;
  const problems: LineItemProblem[] = [];
  if (split.mode === 'units') {
    const units = split.parts.reduce((sum, part) => sum + part.units, 0);
    if (units > item.quantity) problems.push('unitsExceedQuantity');
  }
  if (split.mode === 'amounts') {
    const amounts = split.parts.reduce((sum, part) => sum + BigInt(part.amount), 0n);
    if (amounts > abs(lineTotalMinor(item))) problems.push('amountsExceedLineTotal');
  }
  if (discountExceeds(item.discount, rational(lineTotalMinor(item)))) {
    problems.push('lineDiscountExceedsLineTotal');
  }
  return problems;
}

/**
 * A Split mode started from scratch, as when a Line item switches to it: nothing carries
 * over from the old mode. Even starts with all `participantIds` ticked; Units and Amounts
 * start with nobody assigned.
 */
export function splitFromScratch(
  mode: SplitMode,
  participantIds: readonly string[],
): EvenSplit | { mode: Exclude<SplitMode, 'even'>; parts: [] } {
  switch (mode) {
    case 'even':
      return { mode, participantIds: [...participantIds] };
    case 'units':
    case 'amounts':
      return { mode, parts: [] };
  }
}

/**
 * The split a new Line item starts with, after `lineItems`: the last one's when it was Even,
 * so runs of shared items need no re-ticking; otherwise Even across all `participantIds`.
 */
export function newLineItemSplit(
  lineItems: readonly { split: EvenSplit | { mode: Exclude<SplitMode, 'even'> } }[],
  participantIds: readonly string[],
): EvenSplit {
  const previous = lineItems.at(-1)?.split;
  return previous?.mode === 'even'
    ? { mode: 'even', participantIds: [...previous.participantIds] }
    : { mode: 'even', participantIds: [...participantIds] };
}

import {
  add,
  expenseKind,
  expenseProblems,
  expenseTimeFromLocal,
  expenseTitleSchema,
  fromMinor,
  isDepositRefund,
  localDateTime,
  negate,
  parseMoney,
  parsePercent,
  parseRate,
  receiptShares,
  roundMoney,
  splitFromScratch,
  type Contribution,
  type Currency,
  type Discount,
  type Expense,
  type ExpenseProblem,
  type ExpenseTime,
  type LineItem,
  type ManualRate,
  type Rational,
  type Repayment,
  type Split,
  type SplitExpense,
  type SplitMode,
  type TripCurrency,
  type TripWithParticipants,
} from '@osi/owe-yeah-domain';
import { v7 as uuidv7 } from 'uuid';

// The Expense draft: what the Expense and Repayment forms hold while they are filled in, as
// typed (amounts as text, empty for none), and how it reads as an Expense. Reading a draft
// gives the complete Expense once nothing stands in the way, what it comes to so far, and the
// reasons per field why not: text that can't be read, something missing, or a Trip rule the
// Expense would break (the domain's `expenseProblems`, under their own names). The forms read
// the same result live and when saving. No Vue and no i18n: `useDraftReasons` words the
// reasons.

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

/** A Contribution with its amount as typed. */
export type DraftContribution = { participantId: string; amount: string };

/**
 * A Manual rate as typed: a rate or the amount charged, and the currency it targets. Left
 * empty, there is none; switching the kind keeps what was typed.
 */
export type DraftManualRate = { kind: ManualRate['kind']; value: string; currency: TripCurrency };

/** What both kinds of draft have. */
type DraftBase = {
  id: string;
  title: string;
  /** The currency every amount is entered in. */
  currency: Currency;
  manualRate: DraftManualRate;
  /** The amount as typed, never negative; a Receipt's comes from its Line items instead. */
  amount: string;
  mainPayerId: string;
  /** Local date and time (`YYYY-MM-DDTHH:mm`) in `zone`; empty while not set. */
  local: string;
  zone: string;
};

/** A draft of an Expense split by its Line items: plain, Income or a Receipt. */
export type SplitDraft = DraftBase & {
  kind: 'split';
  /** Income: money received rather than paid. */
  received: boolean;
  /** Who a plain Expense or Income is for. */
  participantIds: string[];
  /** The Till list's Line items once itemised as a Receipt; `null` before. */
  lineItems: DraftLineItem[] | null;
  /** The Receipt discount, used once itemised. */
  discount: DraftDiscount;
  /** Contributions from Participants other than the Main payer, in the order added. */
  contributions: DraftContribution[];
};

/** A draft of a Repayment. */
export type RepaymentDraft = DraftBase & { kind: 'repayment'; recipientId: string };

export type ExpenseDraft = SplitDraft | RepaymentDraft;

/** A form field of a draft, as the forms name their `UFormField`s. */
export type DraftField =
  | 'title'
  | 'amount'
  | 'manualRate'
  | 'mainPayerId'
  | 'recipientId'
  | 'participantIds'
  | 'local'
  | 'lineItems'
  | 'discount'
  | 'contributions';

/**
 * Why a draft doesn't make an Expense yet, at one of its fields: nothing typed or picked
 * (`missing`), text that can't be read (`unreadable`), a title over 100 characters
 * (`tooLong`), or a Trip rule the Expense would break, by its `ExpenseProblem` name. An
 * unreadable Line item also names its line, by its key.
 */
export type DraftReason = {
  field: DraftField;
  code: 'missing' | 'unreadable' | 'tooLong' | ExpenseProblem;
  line?: string;
};

/** A Line item's field that can't be read: a refund's amount is `amount`, not `price`. */
export type LineItemField = 'price' | 'amount' | 'discount' | 'deposit' | 'amounts';

export type LineItemReason = { field: LineItemField; code: 'unreadable' };

/** A Line item read from its draft, or every reason it can't be. */
export type LineItemReading =
  | { lineItem: LineItem; reasons: [] }
  | { lineItem: null; reasons: [LineItemReason, ...LineItemReason[]] };

/** A Receipt as far as it can be read: its readable Line items and Receipt discount. */
export type ReceiptReading = {
  /** The Receipt discount, while it can be read. */
  discount: Discount | undefined;
  /** The computed total, which may be negative. */
  total: Rational;
  /** What the Receipt discount takes off. */
  discountOff: Rational;
  deposits: Rational;
  /** The value not assigned to anyone yet, which counts as the Main payer's. */
  unassigned: Rational;
};

/** What every draft reads as. */
type Reading<E extends Expense> = {
  /** The complete Expense, once there are no reasons; built afresh, without the form's proxies. */
  expense: E | null;
  /** What it comes to so far in its own currency; `null` while that can't be read. */
  total: Rational | null;
  /** When it happened; `null` while not set. */
  time: ExpenseTime | null;
  /**
   * The Manual rate typed: `undefined` for none, as when it targets the Expense's own currency
   * (it is dropped once the Expense is in the Trip currency).
   */
  manualRate: ManualRate | undefined | 'unreadable';
  reasons: DraftReason[];
};

export type SplitReading = Reading<SplitExpense> & {
  /** The Receipt so far, for its live totals; `null` before itemising. */
  receipt: ReceiptReading | null;
  /** What the Main payer covers once the Contributions come off; `null` while unreadable. */
  mainPayerPart: Rational | null;
};

export type RepaymentReading = Reading<Repayment>;

/** An amount in minor units as a Participant would type it, e.g. 2450 EUR → `24.50`. */
export function typedMoney(minor: number, currency: string): string {
  return roundMoney(fromMinor(minor, currency), currency).decimal;
}

/** No discount typed yet; it starts as an amount. */
export const noDiscount = (): DraftDiscount => ({ kind: 'amount', value: '' });

/** A new draft Line item; goods without a Line discount or a Deposit unless they are given. */
export function draftLineItem(
  fields: Pick<DraftLineItem, 'name' | 'price' | 'quantity' | 'split'> &
    Partial<Pick<DraftLineItem, 'discount' | 'deposit' | 'refund'>>,
): DraftLineItem {
  return { key: uuidv7(), discount: noDiscount(), deposit: '', refund: false, ...fields };
}

function draftFromDiscount(discount: Discount | undefined, currency: string): DraftDiscount {
  if (!discount) return noDiscount();
  return discount.kind === 'amount'
    ? { kind: 'amount', value: typedMoney(discount.amount, currency) }
    : { kind: 'percent', value: String(discount.basisPoints / 100) };
}

function draftFromLineItem(item: LineItem, currency: string): DraftLineItem {
  const { split } = item;
  return draftLineItem({
    name: item.name,
    price: typedMoney(Math.abs(item.unitPrice), currency),
    quantity: item.quantity,
    refund: isDepositRefund(item),
    deposit: item.depositPerUnit ? typedMoney(item.depositPerUnit, currency) : '',
    split:
      split.mode === 'amounts'
        ? {
            mode: 'amounts',
            parts: split.parts.map(({ participantId, amount }) => ({
              participantId,
              amount: typedMoney(amount, currency),
            })),
          }
        : structuredClone(split),
    discount: draftFromDiscount(item.discount, currency),
  });
}

function draftFromManualRate(
  manualRate: ManualRate | undefined,
  tripCurrency: TripCurrency,
): DraftManualRate {
  if (!manualRate) return { kind: 'charged', value: '', currency: tripCurrency };
  const { kind, currency } = manualRate;
  return kind === 'rate'
    ? { kind, currency, value: manualRate.rate }
    : { kind, currency, value: typedMoney(manualRate.amount, currency) };
}

/** A saved Expense as its form edits it. */
export function draftFromExpense(
  expense: SplitExpense,
  trip: Pick<TripWithParticipants, 'currency' | 'participants'>,
): SplitDraft;
export function draftFromExpense(
  expense: Repayment,
  trip: Pick<TripWithParticipants, 'currency' | 'participants'>,
): RepaymentDraft;
export function draftFromExpense(
  expense: Expense,
  trip: Pick<TripWithParticipants, 'currency' | 'participants'>,
): ExpenseDraft {
  const { currency } = expense;
  const base: DraftBase = {
    id: expense.id,
    title: expense.title,
    currency,
    manualRate: draftFromManualRate(expense.manualRate, trip.currency),
    amount: '',
    mainPayerId: expense.mainPayerId,
    local: localDateTime(expense.time),
    zone: expense.time.zone,
  };
  const kinded = expenseKind(expense);
  if (kinded.kind === 'repayment') {
    const { amount, recipientId } = kinded.expense;
    return { ...base, kind: 'repayment', amount: typedMoney(amount, currency), recipientId };
  }
  const split = {
    ...base,
    kind: 'split' as const,
    contributions: (kinded.expense.contributions ?? []).map(({ participantId, amount }) => ({
      participantId,
      amount: typedMoney(amount, currency),
    })),
  };
  if (kinded.kind === 'receipt') {
    return {
      ...split,
      received: false,
      participantIds: trip.participants.map(({ id }) => id),
      lineItems: kinded.expense.lineItems.map((item) => draftFromLineItem(item, currency)),
      discount: draftFromDiscount(kinded.expense.discount, currency),
    };
  }
  const [{ unitPrice, split: only }] = kinded.expense.lineItems;
  return {
    ...split,
    amount: typedMoney(Math.abs(unitPrice), currency),
    received: kinded.kind === 'income',
    participantIds: only.mode === 'even' ? [...only.participantIds] : [],
    lineItems: null,
    discount: noDiscount(),
  };
}

/** What a new draft starts from on this device. */
export type DraftStart = {
  /** Now, which a new draft is dated. */
  now: Date;
  /** The device's time zone. */
  zone: string;
  /** Who this device is in the Trip, if anyone. */
  claimId: string | null;
};

function startBase(
  trip: Pick<TripWithParticipants, 'currency'>,
  { now, zone }: DraftStart,
): Omit<DraftBase, 'title' | 'currency' | 'mainPayerId'> {
  return {
    id: uuidv7(),
    manualRate: draftFromManualRate(undefined, trip.currency),
    amount: '',
    local: localDateTime({ instant: now.toISOString(), zone }),
    zone,
  };
}

const knownId = (
  trip: Pick<TripWithParticipants, 'participants'>,
  id: string | null | undefined,
): string | undefined => trip.participants.find((participant) => participant.id === id)?.id;

/**
 * A new plain Expense: in the currency of the Expense saved last on this device, or else the
 * Trip currency; paid by the Claim, or else the first Participant; for everyone; now.
 */
export function newExpenseDraft(
  trip: Pick<TripWithParticipants, 'currency' | 'participants'>,
  start: DraftStart & { lastCurrency: Currency | null },
): SplitDraft {
  return {
    ...startBase(trip, start),
    kind: 'split',
    title: '',
    currency: start.lastCurrency ?? trip.currency,
    mainPayerId: knownId(trip, start.claimId) ?? trip.participants[0]?.id ?? '',
    received: false,
    participantIds: trip.participants.map(({ id }) => id),
    lineItems: null,
    discount: noDiscount(),
    contributions: [],
  };
}

/**
 * A new Repayment in the Trip currency, now, with `title`; it may start from a Suggested
 * Repayment (`suggested`), any part of which may be missing. Who paid defaults to the Claim.
 */
export function newRepaymentDraft(
  trip: Pick<TripWithParticipants, 'currency' | 'participants'>,
  start: DraftStart & {
    title: string;
    suggested?: { payerId?: string; recipientId?: string; amount?: string } | null;
  },
): RepaymentDraft {
  const { suggested } = start;
  return {
    ...startBase(trip, start),
    kind: 'repayment',
    title: start.title,
    currency: trip.currency,
    amount: suggested?.amount ?? '',
    mainPayerId: knownId(trip, suggested?.payerId) ?? knownId(trip, start.claimId) ?? '',
    recipientId: knownId(trip, suggested?.recipientId) ?? '',
  };
}

const blank = (text: string) => text.trim() === '';

type Unread = 'missing' | 'unreadable';

/** An amount as typed: `missing` when nothing is, `unreadable` when it can't be read. */
function readMoney(text: string, currency: string): number | Unread {
  if (blank(text)) return 'missing';
  return parseMoney(text, currency) ?? 'unreadable';
}

const unread = (read: number | Unread): read is Unread =>
  read === 'missing' || read === 'unreadable';

function readDiscount(draft: DraftDiscount, currency: string): Discount | undefined | 'unreadable' {
  if (blank(draft.value)) return undefined;
  if (draft.kind === 'amount') {
    const amount = parseMoney(draft.value, currency);
    return amount === null ? 'unreadable' : { kind: 'amount', amount };
  }
  const basisPoints = parsePercent(draft.value);
  return basisPoints === null ? 'unreadable' : { kind: 'percent', basisPoints };
}

function readLineSplit(split: DraftSplit, currency: string): Split | 'unreadable' {
  if (split.mode === 'even') return { mode: 'even', participantIds: [...split.participantIds] };
  if (split.mode === 'units') {
    return { mode: 'units', parts: split.parts.map((part) => ({ ...part })) };
  }
  const parts: { participantId: string; amount: number }[] = [];
  for (const { participantId, amount } of split.parts) {
    // An Amount left empty is nobody's yet.
    if (blank(amount)) continue;
    const minor = parseMoney(amount, currency);
    if (minor === null) return 'unreadable';
    parts.push({ participantId, amount: minor });
  }
  return { mode: 'amounts', parts };
}

/**
 * The Line item a draft makes, or every reason it can't: its price (a refund's amount), its
 * Line discount, its Deposit or one of its Amounts can't be read. A Deposit refund is one
 * negative unit, whatever else the draft holds. Built afresh, so it holds none of the form's
 * reactive proxies, which the device store cannot keep.
 */
export function readLineItem(draft: DraftLineItem, currency: string): LineItemReading {
  const reasons: LineItemReason[] = [];
  const unreadable = (field: LineItemField) => reasons.push({ field, code: 'unreadable' });

  const price = parseMoney(draft.price, currency);
  if (price === null) unreadable(draft.refund ? 'amount' : 'price');
  const discount = draft.refund ? undefined : readDiscount(draft.discount, currency);
  if (discount === 'unreadable') unreadable('discount');
  const deposit =
    draft.refund || blank(draft.deposit) ? undefined : parseMoney(draft.deposit, currency);
  if (deposit === null) unreadable('deposit');
  const split = readLineSplit(draft.split, currency);
  if (split === 'unreadable') unreadable('amounts');

  if (price === null || discount === 'unreadable' || deposit === null || split === 'unreadable') {
    // SAFETY: each part that can't be read added its reason above.
    return { lineItem: null, reasons: reasons as [LineItemReason, ...LineItemReason[]] };
  }
  const name = draft.name.trim();
  const lineItem: LineItem = draft.refund
    ? { name, unitPrice: -price, quantity: 1, split }
    : {
        name,
        unitPrice: price,
        quantity: draft.quantity,
        // Left out when there is none, as the device store and the server keep them.
        ...(discount && { discount }),
        ...(deposit && { depositPerUnit: deposit }),
        split,
      };
  return { lineItem, reasons: [] };
}

function readManualRate(draft: ExpenseDraft): ManualRate | undefined | 'unreadable' {
  const { manualRate } = draft;
  // Pointed at the Expense's own currency once the Expense is in the Trip currency.
  if (manualRate.currency === draft.currency || blank(manualRate.value)) return undefined;
  const { currency } = manualRate;
  if (manualRate.kind === 'rate') {
    const rate = parseRate(manualRate.value);
    return rate === null ? 'unreadable' : { kind: 'rate', rate, currency };
  }
  const amount = parseMoney(manualRate.value, currency);
  return amount === null ? 'unreadable' : { kind: 'charged', amount, currency };
}

function readContributions(
  drafts: readonly DraftContribution[],
  currency: string,
): Contribution[] | 'unreadable' {
  const contributions: Contribution[] = [];
  for (const { participantId, amount } of drafts) {
    const minor = parseMoney(amount, currency);
    if (minor === null) return 'unreadable';
    contributions.push({ participantId, amount: minor });
  }
  return contributions;
}

/** Ticked Participants in the Trip's order, whatever order they were ticked in. */
function inTripOrder(
  participantIds: readonly string[],
  trip: Pick<TripWithParticipants, 'participants'>,
): string[] {
  const ticked = new Set(participantIds);
  return trip.participants.map(({ id }) => id).filter((id) => ticked.has(id));
}

/** The field a Trip rule an Expense breaks concerns. */
function problemField(problem: ExpenseProblem, draft: ExpenseDraft): DraftField {
  switch (problem) {
    case 'unknownMainPayer':
      return 'mainPayerId';
    case 'unknownParticipant':
      if (draft.kind === 'repayment') return 'recipientId';
      return draft.lineItems ? 'lineItems' : 'participantIds';
    case 'repaymentToSelf':
      return 'recipientId';
    case 'negativeLineItem':
    case 'unitsExceedQuantity':
    case 'amountsExceedLineTotal':
    case 'lineDiscountExceedsLineTotal':
      return 'lineItems';
    case 'receiptDiscountExceedsLineItems':
      return 'discount';
    case 'contributionFromMainPayer':
    case 'contributionsExceedTotal':
      return 'contributions';
    case 'chargedWithoutTotal':
    case 'manualRateToOwnCurrency':
      return 'manualRate';
  }
}

/** What both kinds of draft read the same way, adding their reasons. */
function readBase(draft: ExpenseDraft, reasons: DraftReason[]) {
  const title = draft.title.trim();
  if (!expenseTitleSchema.safeParse(title).success) {
    reasons.push({ field: 'title', code: title === '' ? 'missing' : 'tooLong' });
  }
  const manualRate = readManualRate(draft);
  if (manualRate === 'unreadable') reasons.push({ field: 'manualRate', code: 'unreadable' });
  if (!draft.mainPayerId) reasons.push({ field: 'mainPayerId', code: 'missing' });
  const time = draft.local ? expenseTimeFromLocal(draft.local, draft.zone) : null;
  if (!time) reasons.push({ field: 'local', code: 'missing' });
  return {
    base: {
      id: draft.id,
      title,
      currency: draft.currency,
      mainPayerId: draft.mainPayerId,
      ...(manualRate !== 'unreadable' && manualRate && { manualRate }),
    },
    manualRate,
    time,
  };
}

/**
 * The Expense a draft makes (`candidate`, all of it but its time), checked against the Trip's
 * rules, which are added to `reasons` at the fields they concern, unless a field has a reason
 * already (who paid is missing, not unknown). Checked even while the title or time is still
 * missing, so a rule shows while the form is filled in. The Expense is complete only without
 * any reason.
 */
function checked<E extends Expense>(
  candidate: Omit<E, 'time'> | null,
  time: ExpenseTime | null,
  draft: ExpenseDraft,
  trip: TripWithParticipants,
  reasons: DraftReason[],
): E | null {
  if (!candidate) return null;
  // The rules don't depend on when it happened.
  // SAFETY: an Expense without its time, given one back.
  const expense = { ...candidate, time: time ?? { instant: '', zone: draft.zone } } as E;
  const blocked = new Set(reasons.map(({ field }) => field));
  for (const problem of expenseProblems(expense, trip)) {
    const field = problemField(problem, draft);
    if (!blocked.has(field)) reasons.push({ field, code: problem });
  }
  return reasons.length === 0 ? expense : null;
}

/**
 * How a draft reads (see the module comment): the complete Expense, or the reasons per field
 * why not, and what it comes to so far, for the form's live totals.
 */
export function readDraft(draft: SplitDraft, trip: TripWithParticipants): SplitReading;
export function readDraft(draft: RepaymentDraft, trip: TripWithParticipants): RepaymentReading;
export function readDraft(
  draft: ExpenseDraft,
  trip: TripWithParticipants,
): SplitReading | RepaymentReading;
export function readDraft(
  draft: ExpenseDraft,
  trip: TripWithParticipants,
): SplitReading | RepaymentReading {
  return draft.kind === 'repayment' ? readRepayment(draft, trip) : readSplitDraft(draft, trip);
}

function readRepayment(draft: RepaymentDraft, trip: TripWithParticipants): RepaymentReading {
  const reasons: DraftReason[] = [];
  const amount = readMoney(draft.amount, draft.currency);
  if (unread(amount)) reasons.push({ field: 'amount', code: amount });
  const { base, manualRate, time } = readBase(draft, reasons);
  if (!draft.recipientId) reasons.push({ field: 'recipientId', code: 'missing' });

  const candidate =
    !unread(amount) && manualRate !== 'unreadable'
      ? { ...base, recipientId: draft.recipientId, amount }
      : null;
  return {
    expense: checked<Repayment>(candidate, time, draft, trip, reasons),
    total: !unread(amount) ? fromMinor(amount, draft.currency) : null,
    time,
    manualRate,
    reasons,
  };
}

/** A split draft's Line items as far as they can be read, adding their reasons. */
type LinesReading = {
  /** All of them, once every one can be read, with the Receipt discount. */
  complete: Pick<SplitExpense, 'lineItems' | 'discount'> | null;
  /** What they come to so far; `null` while a plain Expense's amount can't be read. */
  total: Rational | null;
  receipt: ReceiptReading | null;
};

function readLines(
  draft: SplitDraft,
  trip: TripWithParticipants,
  reasons: DraftReason[],
): LinesReading {
  const { currency } = draft;
  if (!draft.lineItems) {
    const price = readMoney(draft.amount, currency);
    if (unread(price)) reasons.push({ field: 'amount', code: price });
    const participantIds = inTripOrder(draft.participantIds, trip);
    if (participantIds.length === 0) reasons.push({ field: 'participantIds', code: 'missing' });
    if (unread(price)) return { complete: null, total: null, receipt: null };
    // Income is saved with a negative amount, so nobody types a minus.
    const unitPrice = draft.received ? -price : price;
    const only: LineItem = { name: '', unitPrice, quantity: 1, split: { mode: 'even', participantIds } };
    return { complete: { lineItems: [only] }, total: fromMinor(unitPrice, currency), receipt: null };
  }

  if (draft.lineItems.length === 0) reasons.push({ field: 'lineItems', code: 'missing' });
  const lineItems = draft.lineItems.flatMap((line) => {
    const { lineItem } = readLineItem(line, currency);
    if (!lineItem) reasons.push({ field: 'lineItems', code: 'unreadable', line: line.key });
    return lineItem ? [lineItem] : [];
  });
  const typed = readDiscount(draft.discount, currency);
  if (typed === 'unreadable') reasons.push({ field: 'discount', code: 'unreadable' });
  const discount = typed === 'unreadable' ? undefined : typed;
  const shares = receiptShares({ lineItems, discount, currency });
  const complete =
    lineItems.length > 0 && lineItems.length === draft.lineItems.length && typed !== 'unreadable'
      ? { lineItems, ...(discount && { discount }) }
      : null;
  return {
    complete,
    total: shares.total,
    receipt: {
      discount,
      total: shares.total,
      discountOff: shares.discountOff,
      deposits: shares.deposits,
      unassigned: shares.unassigned,
    },
  };
}

function readSplitDraft(draft: SplitDraft, trip: TripWithParticipants): SplitReading {
  const reasons: DraftReason[] = [];
  const { currency } = draft;
  const lines = readLines(draft, trip, reasons);
  const { base, manualRate, time } = readBase(draft, reasons);
  const contributions = readContributions(draft.contributions, currency);
  if (contributions === 'unreadable') reasons.push({ field: 'contributions', code: 'unreadable' });

  const candidate =
    lines.complete && manualRate !== 'unreadable' && contributions !== 'unreadable'
      ? {
          ...base,
          ...lines.complete,
          // Left out when there are none, as the device store and the server keep them.
          ...(contributions.length > 0 && { contributions }),
        }
      : null;
  const { total } = lines;
  return {
    expense: checked<SplitExpense>(candidate, time, draft, trip, reasons),
    total,
    time,
    manualRate,
    receipt: lines.receipt,
    mainPayerPart:
      total && contributions !== 'unreadable'
        ? contributions.reduce(
            (left, { amount }) => add(left, negate(fromMinor(amount, currency))),
            total,
          )
        : null,
    reasons,
  };
}

/**
 * Itemise as a Receipt: the amount typed so far becomes the Receipt's first Line item, split
 * Even between the ticked Participants in the Trip's order; with no readable amount, the
 * Receipt starts empty.
 */
export function itemise(draft: SplitDraft, trip: TripWithParticipants): SplitDraft {
  const lineItems =
    parseMoney(draft.amount, draft.currency) === null
      ? []
      : [
          draftLineItem({
            name: '',
            price: draft.amount,
            quantity: 1,
            split: { mode: 'even', participantIds: inTripOrder(draft.participantIds, trip) },
          }),
        ];
  return { ...draft, lineItems };
}

/**
 * The draft with a new Main payer, or `contributes` when they have a Contribution: a Main
 * payer can't have one, so it has to be removed first.
 */
export function pickMainPayer(draft: SplitDraft, participantId: string): SplitDraft | 'contributes' {
  if (draft.contributions.some((contribution) => contribution.participantId === participantId)) {
    return 'contributes';
  }
  return { ...draft, mainPayerId: participantId };
}

/**
 * A Line item switched to another Split mode, which starts from scratch: Even with everyone
 * ticked, Units and Amounts with nobody assigned. Choosing the mode it has changes nothing.
 */
export function chooseSplitMode(
  line: DraftLineItem,
  mode: SplitMode,
  participants: readonly { id: string }[],
): DraftLineItem {
  if (mode === line.split.mode) return line;
  return {
    ...line,
    split: splitFromScratch(
      mode,
      participants.map(({ id }) => id),
    ),
  };
}

import { describe, expect, it } from 'vite-plus/test';
import {
  balances,
  expenseProblems,
  expenseShares,
  isReceipt,
  newLineItemSplit,
  rational,
  splitFromScratch,
  type Expense,
} from '@osi/owe-yeah-domain';

const rafal = '019a2b3c-4d5e-7f00-8a1b-000000000001';
const ania = '019a2b3c-4d5e-7f00-8a1b-000000000002';
const kuba = '019a2b3c-4d5e-7f00-8a1b-000000000003';
const ola = '019a2b3c-4d5e-7f00-8a1b-000000000004';
const everyone = [rafal, ania, kuba, ola];
const trip = {
  id: '019a2b3c-4d5e-7f00-8a1b-2c3d4e5f6a7b',
  name: 'Istria 2026',
  currency: 'EUR' as const,
  participants: everyone.map((id, index) => ({
    id,
    name: ['Rafał', 'Ania', 'Kuba', 'Ola'][index]!,
  })),
};

/** Each Participant's exact balance on this one Receipt, in the Trip's order. */
const balancesOf = (expense: Expense) =>
  balances({ ...trip, expenses: [expense] }).map(({ balance }) => balance);

type LineItem = Extract<Expense, { lineItems: unknown }>['lineItems'][number];

/** A Receipt paid by Rafał with these Line items, in EUR. */
function receipt(...lineItems: LineItem[]): Expense {
  return {
    id: '019a2b3c-4d5e-7f00-8a1b-0000000000e1',
    title: 'Lidl Rovinj',
    currency: 'EUR',
    time: { instant: '2026-07-14T09:30:00Z', zone: 'Europe/Zagreb' },
    mainPayerId: rafal,
    lineItems,
  };
}

const even = (participantIds: string[]) => ({ mode: 'even' as const, participantIds });

describe('expenseShares of a Receipt', () => {
  it('splits a Line item by Units: each Participant bears their units at the unit price', () => {
    const water = receipt({
      name: 'Water 1.5l',
      unitPrice: 29,
      quantity: 6,
      split: {
        mode: 'units',
        parts: [
          { participantId: rafal, units: 3 },
          { participantId: ania, units: 3 },
        ],
      },
    });

    const { total, shares, unassigned } = expenseShares(water);

    expect(total).toEqual(rational(174n, 100n));
    expect([...shares]).toEqual([
      [rafal, rational(87n, 100n)],
      [ania, rational(87n, 100n)],
    ]);
    expect(unassigned).toEqual(rational(0n));
  });
});

describe('a Line item split by Amounts', () => {
  const dinner = (...amounts: [string, number][]) =>
    receipt({
      name: 'Dinner',
      unitPrice: 6400,
      quantity: 1,
      split: {
        mode: 'amounts',
        parts: amounts.map(([participantId, amount]) => ({ participantId, amount })),
      },
    });

  it('gives each Participant their amount, and leaves what is not typed unassigned', () => {
    const { shares, unassigned } = expenseShares(dinner([ania, 2000], [kuba, 1500]));

    expect([...shares]).toEqual([
      [ania, rational(20n)],
      [kuba, rational(15n)],
      // The 29.00 nobody has been given yet is Rafał's, as the Main payer.
      [rafal, rational(29n)],
    ]);
    expect(unassigned).toEqual(rational(29n));
  });

  it('refuses Amounts that add up to more than the full-price Line total', () => {
    expect(expenseProblems(dinner([ania, 4000], [kuba, 3000]), trip)).toEqual([
      'amountsExceedLineTotal',
    ]);
    expect(expenseProblems(dinner([ania, 4000], [kuba, 2400]), trip)).toEqual([]);
  });

  it('refuses a split naming someone who is not in the Trip', () => {
    const stranger = '019a2b3c-4d5e-7f00-8a1b-000000000099';

    expect(expenseProblems(dinner([stranger, 1000]), trip)).toEqual(['unknownParticipant']);
  });
});

describe('Line discounts', () => {
  it('takes a percent off the full-price Line total', () => {
    const wine = receipt({
      name: 'Wine',
      unitPrice: 1999,
      quantity: 1,
      discount: { kind: 'percent', basisPoints: 2500 },
      split: even([ania, kuba]),
    });

    const { total, shares, lineItems } = expenseShares(wine);

    expect(lineItems[0]!.discountOff).toEqual(rational(19_99n, 400n));
    expect(total).toEqual(rational(5997n, 400n));
    expect([...shares.values()]).toEqual([rational(5997n, 800n), rational(5997n, 800n)]);
  });

  it('may take off the whole Line total, and not a cent more', () => {
    const melon = (discount: NonNullable<LineItem['discount']>) =>
      receipt({ name: 'Melon', unitPrice: 199, quantity: 2, discount, split: even(everyone) });

    expect(expenseProblems(melon({ kind: 'amount', amount: 398 }), trip)).toEqual([]);
    expect(expenseProblems(melon({ kind: 'percent', basisPoints: 10_000 }), trip)).toEqual([]);
    expect(expenseProblems(melon({ kind: 'amount', amount: 399 }), trip)).toEqual([
      'lineDiscountExceedsLineTotal',
    ]);
    expect(expenseProblems(melon({ kind: 'percent', basisPoints: 10_001 }), trip)).toEqual([
      'lineDiscountExceedsLineTotal',
    ]);
  });
});

describe('Receipt discounts', () => {
  // Dinner for Rafał and Ania, and a wine for Kuba at half price: 20.00 / 20.00 / 10.00 after
  // Line discounts.
  const dinner = { name: 'Dinner', unitPrice: 4000, quantity: 1, split: even([rafal, ania]) };
  const wine = {
    name: 'Wine',
    unitPrice: 2000,
    quantity: 1,
    discount: { kind: 'percent' as const, basisPoints: 5000 },
    split: even([kuba]),
  };

  it('is spread in proportion to each total after Line discounts, as an amount or a percent', () => {
    for (const discount of [
      { kind: 'amount', amount: 500 },
      { kind: 'percent', basisPoints: 1000 },
    ] as const) {
      const { total, shares } = expenseShares({ ...receipt(dinner, wine), discount });

      expect(total).toEqual(rational(45n));
      expect([...shares]).toEqual([
        [rafal, rational(18n)],
        [ania, rational(18n)],
        [kuba, rational(9n)],
      ]);
    }
  });

  it('may take off everything after Line discounts, and not a cent more', () => {
    const off = (amount: number) => ({
      ...receipt(dinner, wine),
      discount: { kind: 'amount' as const, amount },
    });

    expect(expenseProblems(off(5000), trip)).toEqual([]);
    expect(expenseProblems(off(5001), trip)).toEqual(['receiptDiscountExceedsLineItems']);
  });

  it("takes its part off the value not assigned yet, which stays the Main payer's", () => {
    const unassignedWine = { ...wine, split: even([]) };

    const { shares, unassigned } = expenseShares({
      ...receipt(dinner, unassignedWine),
      discount: { kind: 'amount', amount: 500 },
    });

    expect(unassigned).toEqual(rational(9n));
    expect([...shares]).toEqual([
      [rafal, rational(27n)],
      [ania, rational(18n)],
    ]);
  });
});

describe('the split a Line item starts with', () => {
  it("copies the previous Line item's split when it was Even", () => {
    const previous = { name: 'Bread', unitPrice: 249, quantity: 1, split: even([ania, ola]) };

    expect(newLineItemSplit([previous], everyone)).toEqual(even([ania, ola]));
  });

  it('starts Even across everyone after a Units or Amounts split, or as the first line', () => {
    const units = {
      name: 'Water',
      unitPrice: 29,
      quantity: 6,
      split: { mode: 'units' as const, parts: [{ participantId: rafal, units: 6 }] },
    };

    expect(newLineItemSplit([units], everyone)).toEqual(even(everyone));
    expect(newLineItemSplit([], everyone)).toEqual(even(everyone));
  });

  it('starts a switched Split mode from scratch', () => {
    expect(splitFromScratch('even', everyone)).toEqual(even(everyone));
    expect(splitFromScratch('units', everyone)).toEqual({ mode: 'units', parts: [] });
    expect(splitFromScratch('amounts', everyone)).toEqual({ mode: 'amounts', parts: [] });
  });
});

// The walkthroughs of the Receipt logic prototype (on the `prototype/receipt-entry` branch)
// that need only Split modes and discounts. Rafał pays every Receipt.
describe('Receipt walkthroughs', () => {
  it('Units with a Line discount: 5 × 2.00, 1.00 off, Units 2/2/1 gives 3.60 / 3.60 / 1.80 / 0', () => {
    const beer = {
      name: 'Beer',
      unitPrice: 200,
      quantity: 5,
      discount: { kind: 'amount' as const, amount: 100 },
      split: splitFromScratch('units', everyone),
    };
    // Before anyone drinks, the discounted 9.00 is Rafał's own, as the Main payer.
    expect(expenseShares(receipt(beer)).unassigned).toEqual(rational(9n));

    const drunk = receipt({
      ...beer,
      split: {
        mode: 'units',
        parts: [
          { participantId: rafal, units: 2 },
          { participantId: ania, units: 2 },
          { participantId: kuba, units: 1 },
        ],
      },
    });

    const { total, shares, unassigned } = expenseShares(drunk);
    expect(total).toEqual(rational(9n));
    expect(unassigned).toEqual(rational(0n));
    expect([...shares]).toEqual([
      [rafal, rational(18n, 5n)],
      [ania, rational(18n, 5n)],
      [kuba, rational(9n, 5n)],
    ]);
    expect(balancesOf(drunk)).toEqual([
      rational(27n, 5n),
      rational(-18n, 5n),
      rational(-9n, 5n),
      rational(0n),
    ]);
  });

  it('−10 % coupon: the Receipt discount takes 10 % of the goods', () => {
    // The Pfand half of this walkthrough (never discounted) comes with Deposits.
    const water = { name: 'Mineral water', unitPrice: 53, quantity: 10, split: even(everyone) };

    const { total, discountOff, shares } = expenseShares({
      ...receipt(water),
      discount: { kind: 'percent', basisPoints: 1000 },
    });

    expect(discountOff).toEqual(rational(53n, 100n));
    expect(total).toEqual(rational(477n, 100n));
    expect([...shares.values()]).toEqual(Array.from({ length: 4 }, () => rational(477n, 400n)));
  });

  it('quick shop at the till: shared bread, water by Units, chocolate for Ola', () => {
    const bread = { name: 'Bread', unitPrice: 249, quantity: 1, split: even(everyone) };
    // The water copies the bread's Even split, then switches to Units with nobody assigned.
    const water = {
      name: 'Water 1.5l',
      unitPrice: 29,
      quantity: 6,
      split: newLineItemSplit([bread], everyone),
    };
    expect(water.split).toEqual(even(everyone));

    const unassignedWater = { ...water, split: splitFromScratch('units', everyone) };
    const incomplete = expenseShares(receipt(bread, unassignedWater));
    // The whole water line counts as Rafał's own until it is assigned.
    expect(incomplete.unassigned).toEqual(rational(174n, 100n));
    expect(incomplete.shares.get(rafal)).toEqual(rational(189n, 80n));

    const splitWater = {
      ...water,
      split: {
        mode: 'units' as const,
        parts: [
          { participantId: rafal, units: 3 },
          { participantId: ania, units: 3 },
        ],
      },
    };
    // After Units, the chocolate starts Even across everyone again; then it is Ola's.
    expect(newLineItemSplit([bread, splitWater], everyone)).toEqual(even(everyone));
    const chocolate = { name: 'Chocolate', unitPrice: 89, quantity: 1, split: even([ola]) };

    const done = receipt(bread, splitWater, chocolate);
    const { total, unassigned } = expenseShares(done);
    expect(total).toEqual(rational(512n, 100n));
    expect(unassigned).toEqual(rational(0n));
    expect(expenseProblems(done, trip)).toEqual([]);
    // Bread 2.49 / 4 each, water 0.87 each for Rafał and Ania, chocolate 0.89 for Ola.
    expect(balancesOf(done)).toEqual([
      rational(1451n, 400n),
      rational(-597n, 400n),
      rational(-249n, 400n),
      rational(-121n, 80n),
    ]);
  });

  it("type now, split later: unticked lines count as the Main payer's until assigned", () => {
    const coffee = { name: 'Coffee', unitPrice: 320, quantity: 1, split: even([]) };
    // It copies the empty Even split, so the croissant is unassigned too.
    const croissant = {
      name: 'Croissant',
      unitPrice: 190,
      quantity: 1,
      split: newLineItemSplit([coffee], everyone),
    };
    expect(croissant.split).toEqual(even([]));
    const juice = { name: 'Juice', unitPrice: 240, quantity: 1, split: even(everyone) };

    const atTheTill = receipt(coffee, croissant, juice);
    expect(expenseShares(atTheTill).unassigned).toEqual(rational(51n, 10n));
    expect(expenseProblems(atTheTill, trip)).toEqual([]);
    // Rafał paid 7.50 and bears the unassigned 5.10 plus a quarter of the juice.
    expect(balancesOf(atTheTill)).toEqual([
      rational(9n, 5n),
      rational(-3n, 5n),
      rational(-3n, 5n),
      rational(-3n, 5n),
    ]);

    const inTheCar = receipt(
      { ...coffee, split: even([kuba]) },
      { ...croissant, split: even([ania, ola]) },
      { ...juice, split: even([rafal]) },
    );
    expect(expenseShares(inTheCar).unassigned).toEqual(rational(0n));
    expect(balancesOf(inTheCar)).toEqual([
      rational(51n, 10n),
      rational(-19n, 20n),
      rational(-16n, 5n),
      rational(-19n, 20n),
    ]);
  });

  it("cents that don't add up: shares stay exact thirds, rounded balances add up to zero", () => {
    const pizza = receipt({
      name: 'Pizza',
      unitPrice: 1000,
      quantity: 1,
      split: even([rafal, ania, kuba]),
    });

    expect([...expenseShares(pizza).shares.values()]).toEqual([
      rational(10n, 3n),
      rational(10n, 3n),
      rational(10n, 3n),
    ]);
    expect(balances({ ...trip, expenses: [pizza] }).map(({ rounded }) => rounded)).toEqual([
      rational(667n, 100n),
      rational(-333n, 100n),
      rational(-334n, 100n),
      rational(0n),
    ]);
  });

  it('a tip is an ordinary Line item, split like the dinner', () => {
    // The Contribution half of this walkthrough (Kuba's cash) comes with Contributions.
    const dinner = { name: 'Dinner', unitPrice: 6400, quantity: 1, split: even(everyone) };
    const tip = {
      name: 'Tip',
      unitPrice: 800,
      quantity: 1,
      split: newLineItemSplit([dinner], everyone),
    };

    const { total, shares } = expenseShares(receipt(dinner, tip));

    expect(total).toEqual(rational(72n));
    expect([...shares.values()]).toEqual(Array.from({ length: 4 }, () => rational(18n)));
  });

  it('things that should be refused: more units than bought, a negative line, too big discounts', () => {
    const eggs = {
      name: 'Eggs',
      unitPrice: 35,
      quantity: 3,
      split: {
        mode: 'units' as const,
        parts: [
          { participantId: rafal, units: 2 },
          { participantId: ania, units: 2 },
        ],
      },
    };
    const melon = { name: 'Melon', unitPrice: 199, quantity: 1, split: even(everyone) };
    const bottle = { name: 'Bottle', unitPrice: -25, quantity: 1, split: even(everyone) };

    expect(expenseProblems(receipt(melon, eggs), trip)).toEqual(['unitsExceedQuantity']);
    expect(expenseProblems(receipt(melon, bottle), trip)).toEqual(['negativeLineItem']);
    const melonOff = (discount: NonNullable<LineItem['discount']>) => ({ ...melon, discount });
    expect(expenseProblems(receipt(melonOff({ kind: 'amount', amount: 250 })), trip)).toEqual([
      'lineDiscountExceedsLineTotal',
    ]);
    expect(
      expenseProblems(
        { ...receipt(melon, eggs), discount: { kind: 'percent', basisPoints: 15_000 } },
        trip,
      ),
    ).toEqual(['unitsExceedQuantity', 'receiptDiscountExceedsLineItems']);
  });
});

describe('isReceipt', () => {
  it('tells a Receipt from a plain Expense, whose one Line item is unnamed, single and Even', () => {
    const plain = { name: '', unitPrice: 6290, quantity: 1, split: even(everyone) };

    expect(isReceipt(receipt(plain))).toBe(false);
    expect(isReceipt(receipt(plain, plain))).toBe(true);
    expect(isReceipt(receipt({ ...plain, name: 'Fuel' }))).toBe(true);
    expect(isReceipt(receipt({ ...plain, quantity: 2 }))).toBe(true);
    expect(isReceipt(receipt({ ...plain, split: splitFromScratch('units', everyone) }))).toBe(true);
    const discount = { kind: 'amount' as const, amount: 500 };
    expect(isReceipt(receipt({ ...plain, discount }))).toBe(true);
    expect(isReceipt({ ...receipt(plain), discount })).toBe(true);
  });
});

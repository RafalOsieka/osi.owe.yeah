import { describe, expect, it } from 'vite-plus/test';
import {
  balances,
  expenseRate,
  expenseSchema,
  isRateDateOver,
  neededRates,
  parseRate,
  rateSummary,
  rational,
  shareBreakdowns,
  spendingTotal,
  type Currency,
  type Expense,
  type ManualRate,
  type RateEntry,
  type TripCurrency,
} from '@osi/owe-yeah-domain';

const kasia = { id: '019a2b3c-4d5e-7f00-8a1b-000000000001', name: 'Kasia' };
const ania = { id: '019a2b3c-4d5e-7f00-8a1b-000000000002', name: 'Ania' };

/**
 * A plain Expense of `minor` minor units in `currency` paid by Kasia for both, at a local
 * time in Zagreb (`2026-07-15T01:30` there is still `2026-07-14` in UTC), with an optional
 * Manual rate. Prices `also` make it a Receipt with more Line items.
 */
function expense(
  currency: string,
  minor: number,
  {
    local = '2026-07-14T23:30:00Z',
    manualRate,
    also = [],
  }: { local?: string; manualRate?: ManualRate; also?: number[] } = {},
): Expense {
  return expenseSchema.parse({
    id: '019a2b3c-4d5e-7f00-8a1b-0000000000e1',
    title: 'Ferry',
    currency,
    time: { instant: local, zone: 'Europe/Zagreb' },
    mainPayerId: kasia.id,
    manualRate,
    lineItems: [minor, ...also].map((unitPrice, index) => ({
      name: index === 0 ? '' : `Item ${index}`,
      unitPrice,
      quantity: 1,
      split: { mode: 'even', participantIds: [kasia.id, ania.id] },
    })),
  });
}

function rate(date: string, from: Currency, value: string, fixed = true): RateEntry {
  return { date, from, to: 'EUR', rate: value, fixed };
}

const eur: TripCurrency = 'EUR';

function inEur(rates: RateEntry[], ...expenses: Expense[]) {
  return {
    currency: eur,
    participants: [kasia, ania],
    expenses,
    rates,
  };
}

describe('expenseSchema', () => {
  it('takes any currency in circulation, and no withdrawn or made-up one', () => {
    expect(expense('VND', 100).currency).toBe('VND');
    expect(() => expense('HRK', 100)).toThrow();
    expect(() => expense('XYZ', 100)).toThrow();
  });
});

describe('expenseRate', () => {
  it('converts at the fixed rate for the local date in the Expense zone', () => {
    // 01:30 on 15 July in Zagreb.
    const trip = inEur([rate('2026-07-14', 'USD', '0.5'), rate('2026-07-15', 'USD', '0.25')]);

    expect(expenseRate(expense('USD', 100), trip)).toEqual({
      rate: rational(1n, 4n),
      provisional: false,
      manual: false,
    });
  });

  it('needs no rate in the Trip currency', () => {
    expect(expenseRate(expense('EUR', 100), inEur([]))).toEqual({
      rate: rational(1n),
      provisional: false,
      manual: false,
    });
  });

  it("uses the date's rate that is not fixed yet as a Provisional rate", () => {
    const trip = inEur([rate('2026-07-15', 'USD', '0.875', false), rate('2026-07-14', 'USD', '2')]);

    expect(expenseRate(expense('USD', 100), trip)).toEqual({
      rate: rational(7n, 8n),
      provisional: true,
      manual: false,
    });
  });

  it('falls back to the latest rate cached for the pair as a Provisional rate', () => {
    const trip = inEur([
      rate('2026-07-12', 'USD', '0.3'),
      rate('2026-07-13', 'USD', '0.9'),
      rate('2026-07-15', 'HUF', '0.0025'),
    ]);

    expect(expenseRate(expense('USD', 100), trip)).toEqual({
      rate: rational(9n, 10n),
      provisional: true,
      manual: false,
    });
  });

  it('has no rate for a pair never seen', () => {
    expect(expenseRate(expense('USD', 100), inEur([rate('2026-07-15', 'HUF', '0.0025')]))).toBe(
      null,
    );
  });
});

describe('a Manual rate', () => {
  it('typed as a rate is read leniently and kept as a plain decimal', () => {
    expect(parseRate('4,2975')).toBe('4.2975');
    expect(parseRate(' .25 ')).toBe('0.25');
    expect(parseRate('385')).toBe('385');
    expect(parseRate('0,000')).toBe(null);
    expect(parseRate('4,2.1x')).toBe(null);
  });

  it('typed as a rate replaces the automatic rate', () => {
    const exchanged = expense('HUF', 40_000, {
      manualRate: { kind: 'rate', rate: '0.0025', currency: 'EUR' },
    });
    const trip = inEur([rate('2026-07-15', 'HUF', '0.0024')], exchanged);

    expect(expenseRate(exchanged, trip)).toEqual({
      rate: rational(1n, 400n),
      provisional: false,
      manual: true,
    });
  });

  it('typed as the amount charged converts at charged ÷ total, which a Receipt edit keeps', () => {
    const charged: ManualRate = { kind: 'charged', amount: 3107, currency: 'EUR' };
    const carded = expense('USD', 3333, { manualRate: charged });
    const trip = inEur([rate('2026-07-15', 'USD', '0.9')], carded);

    expect(expenseRate(carded, trip)).toEqual({
      rate: rational(3107n, 3333n),
      provisional: false,
      manual: true,
    });
    expect(balances(trip)[0]!.paid).toEqual(rational(3107n, 100n));

    // The Receipt grows by a 6.67 USD Line item: Kasia was still charged 31.07 EUR.
    const edited = expense('USD', 3333, { manualRate: charged, also: [667] });
    expect(expenseRate(edited, inEur([], edited))!.rate).toEqual(rational(3107n, 4000n));
    expect(balances(inEur([], edited))[0]!.paid).toEqual(rational(3107n, 100n));
  });

  it('typed as the amount charged for Income converts at charged ÷ what came in', () => {
    const received = expense('USD', -2000, {
      manualRate: { kind: 'charged', amount: 1800, currency: 'EUR' },
    });

    expect(expenseRate(received, inEur([], received))!.rate).toEqual(rational(9n, 10n));
  });

  it('chains through the automatic rate for its local date once the Trip currency changed', () => {
    // Charged 45.00 PLN for 10.00 USD, typed while the Trip was in PLN; now it is in EUR.
    const carded = expense('USD', 1000, {
      manualRate: { kind: 'charged', amount: 4500, currency: 'PLN' },
    });
    const trip = inEur(
      [
        rate('2026-07-14', 'PLN', '0.3'),
        rate('2026-07-15', 'PLN', '0.24', false),
        rate('2026-07-15', 'USD', '0.9'),
      ],
      carded,
    );

    // 4.5 PLN per USD × 0.24 EUR per PLN on 15 July, not fixed yet.
    expect(expenseRate(carded, trip)).toEqual({
      rate: rational(27n, 25n),
      provisional: true,
      manual: true,
    });
    expect(expenseRate(carded, inEur([rate('2026-07-15', 'USD', '0.9')], carded))).toBe(null);
  });

  it('is not needed in the Trip currency', () => {
    const back = expense('PLN', 4500, {
      manualRate: { kind: 'rate', rate: '0.25', currency: 'EUR' },
    });
    const trip = { ...inEur([], back), currency: 'PLN' as const };

    expect(expenseRate(back, trip)).toEqual({
      rate: rational(1n),
      provisional: false,
      manual: false,
    });
  });
});

describe('balances in the Trip currency', () => {
  it('converts each Expense and leaves out those without a rate', () => {
    const usd = expense('USD', 10_000);
    const huf = { ...expense('HUF', 500_000), id: '019a2b3c-4d5e-7f00-8a1b-0000000000e2' };
    const trip = inEur([rate('2026-07-15', 'USD', '0.9')], usd, huf);

    // 100.00 USD at 0.9 is 90.00 EUR, half of it each.
    expect(balances(trip).map(({ paid, share, balance }) => ({ paid, share, balance }))).toEqual([
      { paid: rational(90n), share: rational(45n), balance: rational(45n) },
      { paid: rational(0n), share: rational(45n), balance: rational(-45n) },
    ]);
    expect(spendingTotal(trip)).toEqual(rational(90n));
    expect(shareBreakdowns(trip).get(ania.id)).toEqual({
      share: rational(45n),
      parts: [{ part: 'expenses', amount: rational(45n) }],
    });
  });
});

describe('rateSummary', () => {
  it('counts the Expenses at a Provisional rate and those without a rate', () => {
    const trip = inEur(
      [rate('2026-07-10', 'USD', '0.9')],
      expense('USD', 100),
      expense('EUR', 100),
      expense('HUF', 100),
    );

    expect(rateSummary(trip)).toEqual({ provisional: 1, missing: 1 });
  });
});

describe('neededRates', () => {
  it('names each local date and currency not in the Trip currency once', () => {
    const late = expense('USD', 100);
    const early = expense('USD', 100, { local: '2026-07-14T08:00:00Z' });

    expect(neededRates([late, early, late, expense('EUR', 100)], 'EUR')).toEqual([
      { date: '2026-07-15', from: 'USD' },
      { date: '2026-07-14', from: 'USD' },
    ]);
  });

  it('needs the rate a Manual rate is chained through, and none for one typed in the Trip currency', () => {
    const inPln = expense('VND', 100_000, {
      manualRate: { kind: 'charged', amount: 1500, currency: 'PLN' },
    });
    const inEurAlready = expense('KPW', 100, {
      manualRate: { kind: 'rate', rate: '0.001', currency: 'EUR' },
    });

    expect(neededRates([inPln, inEurAlready], 'EUR')).toEqual([
      { date: '2026-07-15', from: 'PLN' },
    ]);
  });
});

describe('isRateDateOver', () => {
  it('holds once the date has ended everywhere, in the last zone at UTC−12', () => {
    expect(isRateDateOver('2026-07-14', '2026-07-15T11:59:59Z')).toBe(false);
    expect(isRateDateOver('2026-07-14', '2026-07-15T12:00:00Z')).toBe(true);
  });
});

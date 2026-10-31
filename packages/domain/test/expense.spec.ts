import { describe, expect, it } from 'vite-plus/test';
import {
  expenseProblems,
  expenseSchema,
  expenseTimeFromLocal,
  groupByLocalDay,
  localDateTime,
  localDay,
  type Expense,
  type TripWithParticipants,
} from '@osi/owe-yeah-domain';

const kasia = { id: '019a2b3c-4d5e-7f00-8a1b-000000000001', name: 'Kasia' };
const ania = { id: '019a2b3c-4d5e-7f00-8a1b-000000000002', name: 'Ania' };
const trip: TripWithParticipants = {
  id: '019a2b3c-4d5e-7f00-8a1b-2c3d4e5f6a7b',
  name: 'Croatia 2026',
  currency: 'EUR',
  participants: [kasia, ania],
};

const lidl: Expense = {
  id: '019a2b3c-4d5e-7f00-8a1b-0000000000e1',
  title: 'Lidl Rovinj',
  currency: 'EUR',
  time: { instant: '2026-07-14T21:30:00Z', zone: 'Europe/Zagreb' },
  mainPayerId: kasia.id,
  lineItems: [{ unitPrice: 2450, split: { mode: 'even', participantIds: [kasia.id, ania.id] } }],
};

describe('expenseSchema', () => {
  it('accepts a plain Expense and keeps its instant in UTC', () => {
    const sent = { ...lidl, time: { instant: '2026-07-14T23:30:00+02:00', zone: 'Europe/Zagreb' } };
    expect(expenseSchema.parse(sent)).toEqual(lidl);
  });

  it.each([
    ['a blank title', { ...lidl, title: '  ' }],
    ['an unknown time zone', { ...lidl, time: { ...lidl.time, zone: 'Mars/Olympus' } }],
    ['a time without an offset', { ...lidl, time: { ...lidl.time, instant: '2026-07-14T21:30' } }],
    ['no Line item', { ...lidl, lineItems: [] }],
    ['two Line items', { ...lidl, lineItems: [...lidl.lineItems, ...lidl.lineItems] }],
    ['a fractional amount', { ...lidl, lineItems: [{ ...lidl.lineItems[0], unitPrice: 24.5 }] }],
    [
      'nobody ticked',
      { ...lidl, lineItems: [{ unitPrice: 2450, split: { mode: 'even', participantIds: [] } }] },
    ],
    [
      'a Participant ticked twice',
      {
        ...lidl,
        lineItems: [
          { unitPrice: 2450, split: { mode: 'even', participantIds: [ania.id, ania.id] } },
        ],
      },
    ],
  ])('rejects %s', (_, sent) => {
    expect(expenseSchema.safeParse(sent).success).toBe(false);
  });
});

describe('expenseProblems', () => {
  it('finds nothing wrong with an Expense that fits the Trip', () => {
    expect(expenseProblems(lidl, trip)).toEqual([]);
  });

  it('refuses a Main payer or a ticked Participant who is not in the Trip', () => {
    const stranger = '019a2b3c-4d5e-7f00-8a1b-000000000099';
    const expense: Expense = {
      ...lidl,
      mainPayerId: stranger,
      lineItems: [{ unitPrice: 2450, split: { mode: 'even', participantIds: [stranger] } }],
    };
    expect(expenseProblems(expense, trip)).toEqual(['unknownMainPayer', 'unknownParticipant']);
  });

  it('refuses a currency other than the Trip currency', () => {
    expect(expenseProblems({ ...lidl, currency: 'HUF' }, trip)).toEqual([
      'currencyNotTripCurrency',
    ]);
  });
});

describe('Expense time', () => {
  it("reads the Expense's local day in its own zone, not the device's", () => {
    // 21:30 UTC is already the next day in Tokyo.
    expect(localDay(lidl.time)).toBe('2026-07-14');
    expect(localDay({ ...lidl.time, zone: 'Asia/Tokyo' })).toBe('2026-07-15');
  });

  it('groups Expenses by their own local day, newest first', () => {
    const at = (id: string, instant: string, zone: string): Expense => ({
      ...lidl,
      id,
      time: { instant, zone },
    });
    const lunch = at(
      '019a2b3c-4d5e-7f00-8a1b-0000000000e2',
      '2026-07-14T10:00:00Z',
      'Europe/Zagreb',
    );
    const dinner = at(
      '019a2b3c-4d5e-7f00-8a1b-0000000000e3',
      '2026-07-14T18:00:00.5Z',
      'Europe/Zagreb',
    );
    // Earlier than dinner in UTC, but already 15 July where it happened.
    const tokyo = at('019a2b3c-4d5e-7f00-8a1b-0000000000e4', '2026-07-14T16:00:00Z', 'Asia/Tokyo');

    expect(groupByLocalDay([lunch, tokyo, dinner])).toEqual([
      { day: '2026-07-15', expenses: [tokyo] },
      { day: '2026-07-14', expenses: [dinner, lunch] },
    ]);
  });

  it('turns a local date and time in a zone into a UTC instant, and back', () => {
    const time = expenseTimeFromLocal('2026-07-14T23:30', 'Europe/Zagreb');
    expect(time).toEqual(lidl.time);
    expect(localDateTime(time)).toBe('2026-07-14T23:30');
  });
});

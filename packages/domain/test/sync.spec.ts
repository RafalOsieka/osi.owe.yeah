import { describe, expect, it } from 'vite-plus/test';
import {
  expenseChangeProblems,
  restoredBy,
  tripTokenSchema,
  type Expense,
  type TripPeople,
} from '@osi/owe-yeah-domain';
import { pushRequestSchema } from '../src/sync.ts';

describe('tripTokenSchema', () => {
  it('refuses a token shorter than 256 bits', () => {
    expect(tripTokenSchema.safeParse('short-and-guessable').success).toBe(false);
  });
});

describe('pushRequestSchema', () => {
  const meta = {
    claimId: null,
    deviceId: '0b6e8f3a-2c1d-4e5f-8a9b-1c2d3e4f5a6b',
  };
  const kasia = { id: '019a2b3c-4d5e-7f00-8a1b-000000000001', name: 'Kasia' };

  it("carries a Trip's creation, its Participants and its Expenses in order", () => {
    const changes = [
      {
        ...meta,
        id: '019a2b3c-4d5e-7f00-8a1b-100000000001',
        kind: 'trip',
        trip: { name: 'Croatia 2026', currency: 'EUR' },
      },
      {
        ...meta,
        id: '019a2b3c-4d5e-7f00-8a1b-100000000002',
        kind: 'participant',
        participant: kasia,
        removed: false,
      },
      {
        ...meta,
        claimId: kasia.id,
        id: '019a2b3c-4d5e-7f00-8a1b-100000000003',
        kind: 'expense',
        baseVersion: null,
        expense: {
          id: '019a2b3c-4d5e-7f00-8a1b-200000000001',
          title: 'Lidl Rovinj',
          currency: 'EUR',
          time: { instant: '2026-07-14T21:30:00Z', zone: 'Europe/Zagreb' },
          mainPayerId: kasia.id,
          lineItems: [
            {
              name: '',
              unitPrice: 2450,
              quantity: 1,
              split: { mode: 'even', participantIds: [kasia.id] },
            },
          ],
        },
        deleted: false,
      },
    ];

    expect(pushRequestSchema.parse({ changes }).changes.map(({ kind }) => kind)).toEqual([
      'trip',
      'participant',
      'expense',
    ]);
  });

  it('refuses a change without the device it came from', () => {
    const change = {
      id: '019a2b3c-4d5e-7f00-8a1b-100000000002',
      claimId: null,
      kind: 'participant',
      participant: kasia,
      removed: false,
    };

    expect(pushRequestSchema.safeParse({ changes: [change] }).success).toBe(false);
  });
});

describe('an Expense change and removed Participants', () => {
  const participant = (n: number, name: string) => ({
    id: `019a2b3c-4d5e-7f00-8a1b-00000000001${n}`,
    name,
  });
  const kasia = participant(1, 'Kasia');
  const ania = participant(2, 'Ania');
  const ola = participant(3, 'Ola');
  const ewa = participant(4, 'Ewa');
  const piotr = participant(5, 'Piotr');
  const tomek = participant(6, 'Tomek');
  const people: TripPeople = {
    participants: [kasia],
    removedParticipants: [ania, ola, ewa, piotr, tomek],
  };
  const time = { instant: '2026-07-14T19:30:00Z', zone: 'Europe/Zagreb' };

  // Paid by Ania, split between Kasia and Ola, with Ewa chipping in.
  const dinner: Expense = {
    id: '019a2b3c-4d5e-7f00-8a1b-0000000000e1',
    title: 'Konoba Batelina',
    currency: 'EUR',
    time,
    mainPayerId: ania.id,
    lineItems: [
      {
        name: '',
        unitPrice: 6000,
        quantity: 1,
        split: { mode: 'even', participantIds: [kasia.id, ola.id] },
      },
    ],
    contributions: [{ participantId: ewa.id, amount: 600 }],
  };
  const repayment: Expense = {
    id: '019a2b3c-4d5e-7f00-8a1b-0000000000e2',
    title: 'Repayment',
    currency: 'EUR',
    time,
    mainPayerId: kasia.id,
    recipientId: piotr.id,
    amount: 1200,
  };

  it('brings back only the removed Participants the Expense references', () => {
    expect(restoredBy(people, { expense: dinner, deleted: false })).toEqual([ania, ola, ewa]);
    expect(restoredBy(people, { expense: repayment, deleted: false })).toEqual([piotr]);
  });

  it('brings back nobody with a deletion', () => {
    expect(restoredBy(people, { expense: dinner, deleted: true })).toEqual([]);
  });

  it('accepts an Expense referencing a removed Participant, but not one the Trip never had', () => {
    expect(expenseChangeProblems({ expense: dinner }, people)).toEqual([]);
    const stranger = '019a2b3c-4d5e-7f00-8a1b-000000000099';
    expect(
      expenseChangeProblems({ expense: { ...repayment, recipientId: stranger } }, people),
    ).toEqual(['unknownParticipant']);
  });
});

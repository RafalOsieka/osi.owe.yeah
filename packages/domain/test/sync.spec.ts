import { describe, expect, it } from 'vite-plus/test';
import { pushRequestSchema, tripTokenSchema } from '@osi/owe-yeah-domain';

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
          lineItems: [{ unitPrice: 2450, split: { mode: 'even', participantIds: [kasia.id] } }],
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
    };

    expect(pushRequestSchema.safeParse({ changes: [change] }).success).toBe(false);
  });
});

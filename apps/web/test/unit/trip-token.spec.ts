import { tripTokenSchema } from '@osi/owe-yeah-domain';
import { describe, expect, it } from 'vitest';
import { newTripToken } from '../../app/utils/trip-token';

describe('newTripToken', () => {
  it('makes a Trip link token of 256 random bits, never twice the same', () => {
    const [first, second] = [newTripToken(), newTripToken()];

    expect(tripTokenSchema.safeParse(first).success).toBe(true);
    expect(first).not.toBe(second);
  });
});

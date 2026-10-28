import { describe, expect, it } from 'vite-plus/test';
import { tripSchema } from '@osi/owe-yeah-domain';

const valid = { id: '019a2b3c-4d5e-7f00-8a1b-2c3d4e5f6a7b', name: 'Croatia 2026', currency: 'EUR' };

describe('tripSchema', () => {
  it('accepts a Trip and trims its name', () => {
    expect(tripSchema.parse({ ...valid, name: '  Croatia 2026 ' })).toEqual(valid);
  });

  it('rejects an id that is not a UUIDv7', () => {
    const v4 = '0b6e8f3a-2c1d-4e5f-8a9b-1c2d3e4f5a6b';
    expect(tripSchema.safeParse({ ...valid, id: v4 }).success).toBe(false);
  });

  it('rejects a blank name', () => {
    expect(tripSchema.safeParse({ ...valid, name: '   ' }).success).toBe(false);
  });

  it('rejects a currency the rate provider does not cover', () => {
    expect(tripSchema.safeParse({ ...valid, currency: 'HRK' }).success).toBe(false);
  });
});

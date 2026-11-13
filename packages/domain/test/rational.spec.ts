import { describe, expect, it } from 'vite-plus/test';
import { absolute, rational } from '@osi/owe-yeah-domain';

describe('absolute', () => {
  it('drops the sign of a negative amount and keeps the rest', () => {
    expect(absolute(rational(-7n, 3n))).toEqual(rational(7n, 3n));
    expect(absolute(rational(7n, 3n))).toEqual(rational(7n, 3n));
    expect(absolute(rational(0n))).toEqual(rational(0n));
  });
});

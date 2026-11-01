import { rational } from '@osi/owe-yeah-domain';
import { describe, expect, it } from 'vitest';
import { barWidths } from '../../app/utils/bars';

describe('barWidths', () => {
  it('scales each amount to the largest one, owing and owed alike', () => {
    expect(barWidths([rational(8420n, 100n), rational(-45n), rational(-1n, 3n)])).toEqual([
      100,
      (45 / 84.2) * 100,
      (1 / 3 / 84.2) * 100,
    ]);
  });

  it('draws every bar at zero when nobody owes anything', () => {
    expect(barWidths([rational(0n), rational(0n)])).toEqual([0, 0]);
  });
});

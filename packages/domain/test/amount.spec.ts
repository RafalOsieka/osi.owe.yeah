import { describe, expect, it } from 'vite-plus/test';
import { parseAmount, rational } from '@osi/owe-yeah-domain';

describe('parseAmount', () => {
  it.each([
    ['0,29', rational(29n, 100n)],
    [',29', rational(29n, 100n)],
    ['.29', rational(29n, 100n)],
    ['0.29', rational(29n, 100n)],
    ['1.234,50', rational(123450n, 100n)],
    ['1 234,50', rational(123450n, 100n)],
    ['2,5 €', rational(25n, 10n)],
    ['12', rational(12n)],
  ])('parses %j', (text, expected) => {
    expect(parseAmount(text)).toEqual(expected);
  });

  it('treats the last separator as decimal even when it looks like grouping', () => {
    expect(parseAmount('1.234')).toEqual(rational(1234n, 1000n));
  });

  it('ignores non-breaking spaces and other currency symbols', () => {
    expect(parseAmount('\u00a01\u202f234,50 $')).toEqual(rational(123450n, 100n));
  });

  it.each(['', '   ', '€', ',', 'abc', '1,2x', '-5'])('rejects %j', (text) => {
    expect(parseAmount(text)).toBeNull();
  });
});

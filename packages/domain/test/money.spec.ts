import { describe, expect, it } from 'vite-plus/test';
import { minorUnits, parseMoney } from '@osi/owe-yeah-domain';

describe('minorUnits', () => {
  it.each([
    ['JPY', 0],
    ['EUR', 2],
    ['KWD', 3],
  ])('%s has %i', (currency, expected) => {
    expect(minorUnits(currency)).toBe(expected);
  });
});

describe('parseMoney', () => {
  it.each([
    ['0,29', 'EUR', 29],
    ['12', 'EUR', 1200],
    ['1.234,5', 'EUR', 123450],
    ['1 500', 'JPY', 1500],
    ['1,234', 'KWD', 1234],
  ])('reads %j in %s as %i minor units', (text, currency, expected) => {
    expect(parseMoney(text, currency)).toBe(expected);
  });

  it.each([
    ['0,291', 'EUR'],
    ['1,5', 'JPY'],
    ['abc', 'EUR'],
    ['0', 'EUR'],
  ])('rejects %j in %s', (text, currency) => {
    expect(parseMoney(text, currency)).toBeNull();
  });
});

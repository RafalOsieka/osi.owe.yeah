import { describe, expect, it } from 'vite-plus/test';
import { parsePercent } from '@osi/owe-yeah-domain';

describe('parsePercent', () => {
  it.each([
    ['10', 1000],
    ['12,5', 1250],
    ['0.25 %', 25],
    ['150', 15_000],
  ])('reads %j as %i basis points', (text, expected) => {
    expect(parsePercent(text)).toBe(expected);
  });

  it.each(['0', '0,001', 'abc', ''])('rejects %j', (text) => {
    expect(parsePercent(text)).toBeNull();
  });
});

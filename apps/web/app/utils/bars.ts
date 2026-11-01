import type { Rational } from '@osi/owe-yeah-domain';

/**
 * How long each bar of a diverging bar chart is, as a percentage of the longest: amounts
 * are scaled to the largest one, ignoring sign. All zeros when every amount is zero.
 */
export function barWidths(amounts: readonly Rational[]): number[] {
  const sizes = amounts.map(({ numerator, denominator }) =>
    Math.abs(Number(numerator) / Number(denominator)),
  );
  const largest = Math.max(0, ...sizes);
  return sizes.map((size) => (largest === 0 ? 0 : (size / largest) * 100));
}

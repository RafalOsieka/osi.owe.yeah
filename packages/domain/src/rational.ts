/**
 * An exact fraction on bigint. All money arithmetic uses it; nothing is rounded inside a Trip.
 * Always built with `rational()`, so it is reduced and the denominator is positive, which makes
 * structurally equal values numerically equal.
 */
export type Rational = {
  readonly numerator: bigint;
  readonly denominator: bigint;
};

const abs = (value: bigint) => (value < 0n ? -value : value);

function gcd(a: bigint, b: bigint): bigint {
  let [x, y] = [abs(a), abs(b)];
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

/** Builds a reduced `Rational`. Throws on a zero denominator. */
export function rational(numerator: bigint, denominator = 1n): Rational {
  if (denominator === 0n) throw new RangeError('Rational denominator must not be zero');
  const sign = denominator < 0n ? -1n : 1n;
  const divisor = gcd(numerator, denominator);
  return {
    numerator: (sign * numerator) / divisor,
    denominator: (sign * denominator) / divisor,
  };
}

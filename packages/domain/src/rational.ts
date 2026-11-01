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

/** The exact sum of two Rationals. */
export function add(a: Rational, b: Rational): Rational {
  return rational(
    a.numerator * b.denominator + b.numerator * a.denominator,
    a.denominator * b.denominator,
  );
}

/** The exact difference `a - b`. */
export function subtract(a: Rational, b: Rational): Rational {
  return add(a, negate(b));
}

/** `value` rounded to the nearest whole number, halves away from zero. */
export function roundHalfAwayFromZero(value: Rational): bigint {
  const magnitude = abs(value.numerator);
  const rounded = (2n * magnitude + value.denominator) / (2n * value.denominator);
  return value.numerator < 0n ? -rounded : rounded;
}

/** `-value`. */
export function negate(value: Rational): Rational {
  return rational(-value.numerator, value.denominator);
}

/** The largest whole number not above `value`. */
export function floor(value: Rational): bigint {
  const quotient = value.numerator / value.denominator;
  return value.numerator % value.denominator < 0n ? quotient - 1n : quotient;
}

/** Negative when `a < b`, zero when equal, positive when `a > b`. */
export function compare(a: Rational, b: Rational): number {
  const difference = a.numerator * b.denominator - b.numerator * a.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

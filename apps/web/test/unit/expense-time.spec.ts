import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatInstant } from '../../app/utils/expense-time';

const at = '2026-11-06T20:42:00Z';

// A device's settings are what `Intl` resolves without a locale or zone: its clock from
// `deviceLocale`, and here the UTC zone.
function onDevice(deviceLocale: string): void {
  const Real = Intl.DateTimeFormat;
  vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (
    locale?: Intl.LocalesArgument,
    options?: Intl.DateTimeFormatOptions,
  ) {
    return new Real(locale ?? deviceLocale, { timeZone: 'UTC', ...options });
  });
}

describe('formatInstant', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps the app language but follows the device clock', () => {
    onDevice('en-GB');
    expect(formatInstant(at, 'en')).toBe('Nov 6, 2026, 20:42');
  });

  it('shows a 12-hour time on a 12-hour device', () => {
    onDevice('en-US');
    expect(formatInstant(at, 'en')).toMatch(/^Nov 6, 2026, 8:42\sPM$/);
  });
});

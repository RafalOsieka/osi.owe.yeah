import type { ExpenseTime } from '@osi/owe-yeah-domain';

/**
 * The device's clock, 12- or 24-hour, as its own date and time fields show it. Times keep the
 * app's language but follow it, so "Today, 20:57" matches the field it is edited in.
 */
export function deviceHourCycle(): Intl.DateTimeFormatOptions['hourCycle'] {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle;
}

/**
 * When an Expense was paid, in words, in its own zone (e.g. "Tue, Jul 14, 2026, 11:30 PM"),
 * as its detail page and the Conflict screen show it, on the device's clock.
 */
export function formatExpenseTime(time: ExpenseTime, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: deviceHourCycle(),
    timeZone: time.zone,
  }).format(new Date(time.instant));
}

/** A time zone as people say it: its city, e.g. "New York" for `America/New_York`. */
export function zoneName(zone: string): string {
  return (zone.split('/').at(-1) ?? zone).replaceAll('_', ' ');
}

/**
 * A time zone as the zone picker lists it: its city and its offset from UTC `at` that moment,
 * e.g. "Warsaw · UTC+1", or "Kolkata · UTC+5:30".
 */
export function zoneLabel(zone: string, at: Date): string {
  const offset =
    new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(at)
      .find(({ type }) => type === 'timeZoneName')?.value ?? 'GMT';
  return `${zoneName(zone)} · ${offset.replace('GMT', 'UTC').replace('-', '−')}`;
}

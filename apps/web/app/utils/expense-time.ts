import type { ExpenseTime } from '@osi/owe-yeah-domain';

/**
 * When an Expense was paid, in words, in its own zone (e.g. "Tue, Jul 14, 2026, 11:30 PM"),
 * as its detail page and the Conflict screen show it.
 */
export function formatExpenseTime(time: ExpenseTime, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: time.zone,
  }).format(new Date(time.instant));
}

/** A time zone as people say it: its city, e.g. "New York" for `America/New_York`. */
export function zoneName(zone: string): string {
  return (zone.split('/').at(-1) ?? zone).replaceAll('_', ' ');
}

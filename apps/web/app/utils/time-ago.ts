// The units a time ago is said in, largest first, with their length in seconds.
const UNITS = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
] as const satisfies readonly (readonly [Intl.RelativeTimeFormatUnit, number])[];

/**
 * How long before `now` an ISO instant was, in the largest whole unit (e.g. "2 hr. ago"), as
 * "last edited" and History say it. Under a minute is "now".
 */
export function formatTimeAgo(at: string, now: Date, locale: string): string {
  const seconds = (new Date(at).getTime() - now.getTime()) / 1000;
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  const unit = UNITS.find(([, length]) => Math.abs(seconds) >= length);
  return unit ? format.format(Math.round(seconds / unit[1]), unit[0]) : format.format(0, 'second');
}

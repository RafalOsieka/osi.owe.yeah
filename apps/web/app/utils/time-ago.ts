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
 * How long before `now` an ISO instant was, in the largest whole unit, spelled out (e.g. "2
 * hours ago"), as "last edited" and History say it. Under a minute is `justNow` (e.g. "just
 * now"), or the locale's own "now" without it.
 */
export function formatTimeAgo(at: string, now: Date, locale: string, justNow?: string): string {
  const seconds = (new Date(at).getTime() - now.getTime()) / 1000;
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'long' });
  const unit = UNITS.find(([, length]) => Math.abs(seconds) >= length);
  if (unit) return format.format(Math.round(seconds / unit[1]), unit[0]);
  return justNow ?? format.format(0, 'second');
}

/**
 * When a change was made, as "last edited", "last changed" and Recently deleted say it: how
 * long ago by the server's clock (`formatTimeAgo`), or `notSyncedYet` while the server hasn't
 * answered (`at` missing).
 */
export function formatEditedAt(
  at: string | null | undefined,
  now: Date,
  locale: string,
  words: { justNow: string; notSyncedYet: string },
): string {
  return at ? formatTimeAgo(at, now, locale, words.justNow) : words.notSyncedYet;
}

import type { PushMessage } from '@osi/owe-yeah-domain';
import en from '../../i18n/locales/en.json';
import pl from '../../i18n/locales/pl.json';

// The service worker's own copy of the catalogs' `push` messages, bundled into it, so it
// writes notifications offline and the server needs no i18n. They are plain text with
// `{name}` placeholders: no plurals, links or escapes.
const catalogs = { en: en.push, pl: pl.push };

export type NotificationLocale = keyof typeof catalogs;

/** What a notification remembers, to collapse the next one into it and to open it. */
export type NotificationData = {
  tripId: string;
  /** The Expense to highlight once opened; `null` once collapsed. */
  expenseId: string | null;
  /** How many changes it stands for. */
  count: number;
};

/** A notification as the service worker shows it: `showNotification(title, options)`. */
export type ShownNotification = {
  title: string;
  options: NotificationOptions & { data: NotificationData };
};

/**
 * The locale notifications are written in: the first of the browser's languages the app
 * has, as the app picks its own (`detectBrowserLanguage`), English otherwise.
 */
export function notificationLocale(languages: readonly string[]): NotificationLocale {
  for (const language of languages) {
    const primary = language.split('-')[0]?.toLowerCase();
    if (primary === 'en' || primary === 'pl') return primary;
  }
  return 'en';
}

/**
 * The notification to show for a push message, tagged with its Trip so a burst replaces one
 * notification instead of piling up. `shown` is how many changes the Trip's notification on
 * screen already stands for (0 without one): with more than one change in all, it reads
 * "3 changes in Croatia 2026" and opens no Expense. Otherwise it says who did what to which
 * Expense, and how that moved what you paid and your share.
 */
export function notificationFor(
  message: PushMessage,
  shown: number,
  locale: NotificationLocale,
): ShownNotification {
  const messages = catalogs[locale];
  const say = (key: keyof typeof messages, values: Record<string, string | number>) =>
    messages[key].replace(/\{(\w+)\}/g, (_, name: string) => String(values[name]));
  const { tripId, tripName, currency, latest } = message;
  const tag = `trip:${tripId}`;
  const count = shown + message.count;
  if (count > 1) {
    return {
      title: say('collapsed', { count, trip: tripName }),
      options: { tag, data: { tripId, expenseId: null, count } },
    };
  }

  const format = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    signDisplay: 'exceptZero',
  });
  // SAFETY: the push message schema checks both are plain decimals.
  const amounts = (['share', 'paid'] as const)
    .filter((part) => Number(latest[part]) !== 0)
    .map((part) => say(part, { amount: format.format(latest[part] as `${number}`) }));
  const author = latest.author ?? say('someone', {});
  const done = say(latest.action, { author, title: latest.title });
  return {
    title: tripName,
    options: {
      tag,
      body: [done, ...(amounts.length > 0 ? [amounts.join(' · ')] : [])].join('\n'),
      data: { tripId, expenseId: latest.expenseId, count },
    },
  };
}

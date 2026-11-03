import type { ActivityMessage, PushMessage, ReminderMessage } from '@osi/owe-yeah-domain';
import en from '../../i18n/locales/en.json';
import pl from '../../i18n/locales/pl.json';

// The service worker's own copy of the catalogs' `push` messages, bundled into it, so it
// writes notifications offline and the server needs no i18n. They are plain text with
// `{name}` placeholders: no plurals, links or escapes.
const catalogs = { en: en.push, pl: pl.push };

export type NotificationLocale = keyof typeof catalogs;

type Messages = (typeof catalogs)[NotificationLocale];

/** What a notification remembers, to collapse the next one into it and to open it. */
export type NotificationData = {
  /** The app page tapping it opens. */
  url: string;
  /** How many changes it stands for; always 1 for a Reminder. */
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

/** The tag a Trip's activity notifications share, so a burst replaces one on screen. */
export const activityTag = (tripId: string) => `trip:${tripId}`;

/**
 * The notification to show for a push message: about a Trip's activity
 * (`activityNotification`), or a Reminder (`reminderNotification`). `shown` is how many
 * changes the Trip's activity notification on screen already stands for (0 without one).
 */
export function notificationFor(
  message: PushMessage,
  shown: number,
  locale: NotificationLocale,
): ShownNotification {
  const messages = catalogs[locale];
  const say = (key: keyof Messages, values: Record<string, string | number> = {}) =>
    messages[key].replace(/\{(\w+)\}/g, (_, name: string) => String(values[name]));
  const format = (currency: string, amount: `${number}`, signed: boolean) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      signDisplay: signed ? 'exceptZero' : 'auto',
    }).format(amount);
  return message.kind === 'reminder'
    ? reminderNotification(message, say, format)
    : activityNotification(message, shown, say, format);
}

type Say = (key: keyof Messages, values?: Record<string, string | number>) => string;
type Format = (currency: string, amount: `${number}`, signed: boolean) => string;

/**
 * Tagged with its Trip so a burst replaces one notification instead of piling up: with more
 * than one change in all, it reads "3 changes in Croatia 2026" and opens the Trip's
 * Expenses. Otherwise it says who did what to which Expense, and how that moved what you
 * paid and your share, and opens the Expenses with that one highlighted.
 */
function activityNotification(
  message: ActivityMessage,
  shown: number,
  say: Say,
  format: Format,
): ShownNotification {
  const { tripId, tripName, currency, latest } = message;
  const tag = activityTag(tripId);
  const count = shown + message.count;
  if (count > 1) {
    return {
      title: say('collapsed', { count, trip: tripName }),
      options: { tag, data: { url: `/trips/${tripId}`, count } },
    };
  }

  // SAFETY: the push message schema checks both are plain decimals.
  const amounts = (['share', 'paid'] as const)
    .filter((part) => Number(latest[part]) !== 0)
    .map((part) => say(part, { amount: format(currency, latest[part] as `${number}`, true) }));
  const author = latest.author ?? say('someone');
  const done = say(latest.action, { author, title: latest.title });
  return {
    title: tripName,
    options: {
      tag,
      body: [done, ...(amounts.length > 0 ? [amounts.join(' · ')] : [])].join('\n'),
      data: { url: `/trips/${tripId}?highlight=${latest.expenseId}`, count },
    },
  };
}

/**
 * "Kasia reminds you to pay them back 123.45 PLN", one per creditor and Trip, never
 * collapsed into the Trip's activity. Opens Balances with that Suggested Repayment
 * highlighted, its Record one tap away.
 */
function reminderNotification(
  message: ReminderMessage,
  say: Say,
  format: Format,
): ShownNotification {
  const { tripId, tripName, currency, from, to, amount } = message;
  // SAFETY: the push message schema checks it is a plain decimal.
  const owed = format(currency, amount as `${number}`, false);
  return {
    title: tripName,
    options: {
      tag: `reminder:${tripId}:${from.id}`,
      body: say('reminder', { name: from.name, amount: owed }),
      data: { url: `/trips/${tripId}/balances?payer=${to}&recipient=${from.id}`, count: 1 },
    },
  };
}

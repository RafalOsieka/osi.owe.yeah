import type { PushMessage } from '@osi/owe-yeah-domain';
import { describe, expect, it } from 'vitest';
import { notificationFor, notificationLocale } from '../../app/service-worker/notification';

const message: PushMessage = {
  tripId: '019a2b3c-4d5e-7f00-8a1b-2c3d4e5f6a7b',
  tripName: 'Croatia 2026',
  currency: 'EUR',
  count: 1,
  latest: {
    expenseId: '019a2b3c-4d5e-7f00-8a1b-0000000000e1',
    title: 'Lidl Rovinj',
    author: 'Kasia',
    action: 'added',
    paid: '0.00',
    share: '15.00',
  },
};

// Intl puts a no-break space between a Polish amount and its currency.
const nbsp = ' ';

describe('notificationFor', () => {
  it('says who changed which Expense and how it moved your share, tagged with the Trip', () => {
    expect(notificationFor(message, 0, 'en')).toEqual({
      title: 'Croatia 2026',
      options: {
        tag: `trip:${message.tripId}`,
        body: 'Kasia added “Lidl Rovinj”\nYour share +€15.00',
        data: { tripId: message.tripId, expenseId: message.latest.expenseId, count: 1 },
      },
    });
  });

  it('writes it in Polish, naming what you paid too, and "someone" without an author', () => {
    const deleted = {
      ...message,
      latest: { ...message.latest, author: null, action: 'deleted', paid: '-30.00' },
    } satisfies PushMessage;

    expect(notificationFor(deleted, 0, 'pl').options.body).toBe(
      `Usunięty wydatek: „Lidl Rovinj” (ktoś)\nTwój udział +15,00${nbsp}€ · Twoja płatność -30,00${nbsp}€`,
    );
  });

  it('collapses into one notification per Trip, counting the one already shown, with no Expense to open', () => {
    expect(notificationFor({ ...message, count: 2 }, 1, 'en')).toEqual({
      title: '3 changes in Croatia 2026',
      options: {
        tag: `trip:${message.tripId}`,
        data: { tripId: message.tripId, expenseId: null, count: 3 },
      },
    });
  });
});

describe('notificationLocale', () => {
  it("follows the browser's languages as the app does, English otherwise", () => {
    expect(notificationLocale(['pl-PL', 'en-US'])).toBe('pl');
    expect(notificationLocale(['de-DE', 'en-GB'])).toBe('en');
    expect(notificationLocale(['de-DE'])).toBe('en');
  });
});

import { useRuntimeConfig } from 'nuxt/server';
import { getDb } from '../db';
import type { VapidDetails } from '../notifications/delivery';
import { createNotifications } from '../notifications/activity';
import { createReminders } from '../utils/reminders';
import { createRates } from './rates';
import { createTripStore } from './store';
import { createTripSync } from './sync';

/**
 * The composition root of the server's Trip modules: the one place that reaches for the
 * shared database and the runtime config. Each module is built on first use and kept for the
 * process, so nothing touches the database or the runtime config before a request needs it.
 */
function lazy<T>(make: () => T): () => T {
  let made: { value: T } | undefined;
  return () => (made ??= { value: make() }).value;
}

/** The VAPID keys Notifications and Reminders are signed with; `null` when none are set, so nothing is sent. */
const vapid = lazy((): VapidDetails | null => {
  const { vapidPublicKey, vapidPrivateKey, vapidSubject } = useRuntimeConfig();
  if (!vapidPublicKey || !vapidPrivateKey) return null;
  return { subject: vapidSubject, publicKey: vapidPublicKey, privateKey: vapidPrivateKey };
});

export const tripStore = lazy(() => createTripStore(getDb()));

export const tripRates = lazy(() => createRates(getDb(), useRuntimeConfig().frankfurterUrl));

export const reminders = lazy(() => createReminders(getDb(), tripStore(), tripRates(), vapid()));

const notifications = lazy(() => createNotifications(getDb(), tripStore(), tripRates(), vapid()));

export const tripSync = lazy(() =>
  createTripSync(getDb(), tripStore(), tripRates(), notifications()),
);

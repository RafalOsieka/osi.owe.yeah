import { useRuntimeConfig } from 'nuxt/server';
import { getDb } from '../db';
import { createNotifications } from '../notifications/activity';
import type { VapidDetails } from '../notifications/delivery';
import { createReminders } from '../notifications/reminders';
import { createSubscriptions } from '../notifications/subscriptions';
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

/**
 * What Notifications and Reminders are signed with; `null` when no VAPID keys are set, so
 * nothing is sent.
 */
const vapid = lazy((): VapidDetails | null => {
  const { vapidPublicKey, vapidPrivateKey, vapidSubject } = useRuntimeConfig();
  if (!vapidPublicKey || !vapidPrivateKey) return null;
  return { subject: vapidSubject, publicKey: vapidPublicKey, privateKey: vapidPrivateKey };
});

export const tripStore = lazy(() => createTripStore(getDb()));

export const tripRates = lazy(() => createRates(getDb(), useRuntimeConfig().frankfurterUrl));

/**
 * Notification subscriptions, taken and sent to at any endpoint only where
 * `notificationsAnyEndpoint` says so (in tests).
 */
export const subscriptions = lazy(() =>
  createSubscriptions(getDb(), { anyEndpoint: useRuntimeConfig().notificationsAnyEndpoint }),
);

export const reminders = lazy(() =>
  createReminders(getDb(), tripStore(), tripRates(), subscriptions(), vapid()),
);

const notifications = lazy(() =>
  createNotifications(tripStore(), tripRates(), subscriptions(), vapid()),
);

export const tripSync = lazy(() => createTripSync(getDb(), tripRates(), notifications()));

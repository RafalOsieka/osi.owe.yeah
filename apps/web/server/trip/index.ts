import { useRuntimeConfig } from 'nuxt/server';
import { getDb } from '../db';
import type { PushSettings } from '../notifications/delivery';
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

/**
 * What Notifications and Reminders are sent with (`PushSettings`); `null` when no VAPID keys
 * are set, so nothing is sent.
 */
const push = lazy((): PushSettings | null => {
  const { vapidPublicKey, vapidPrivateKey, vapidSubject, notificationsAnyEndpoint } =
    useRuntimeConfig();
  if (!vapidPublicKey || !vapidPrivateKey) return null;
  const vapid = { subject: vapidSubject, publicKey: vapidPublicKey, privateKey: vapidPrivateKey };
  return { vapid, anyEndpoint: notificationsAnyEndpoint };
});

export const tripStore = lazy(() => createTripStore(getDb()));

export const tripRates = lazy(() => createRates(getDb(), useRuntimeConfig().frankfurterUrl));

export const reminders = lazy(() => createReminders(getDb(), tripStore(), tripRates(), push()));

const notifications = lazy(() => createNotifications(getDb(), tripStore(), tripRates(), push()));

export const tripSync = lazy(() =>
  createTripSync(getDb(), tripStore(), tripRates(), notifications()),
);

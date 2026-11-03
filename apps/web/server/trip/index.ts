import { useRuntimeConfig } from 'nuxt/server';
import { getDb } from '../db';
import { createNotifications } from '../notifications/activity';
import { createReminders } from '../utils/reminders';
import { createRates } from './rates';
import { createTripStore } from './store';

/**
 * The composition root of the server's Trip modules: the one place that reaches for the
 * shared database. Each module is built on first use and kept for the process, so nothing
 * touches the database or the runtime config before a request needs it.
 */
function lazy<T extends object>(make: () => T): () => T {
  let made: T | undefined;
  return () => (made ??= make());
}

export const tripStore = lazy(() => createTripStore(getDb()));

export const tripRates = lazy(() => createRates(getDb(), useRuntimeConfig().frankfurterUrl));

export const reminders = lazy(() => createReminders(getDb(), tripStore(), tripRates()));

export const notifications = lazy(() => createNotifications(getDb(), tripStore(), tripRates()));

/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import {
  activityTag,
  notificationFor,
  notificationLocale,
  pushMessage,
  type NotificationData,
} from './notification';

// The app's service worker (`pwa` in `nuxt.config.ts`): precaches the app shell, serves `/`
// for every page while offline and never caches the API (ADR 0002), as `generateSW` did; and
// shows push notifications: of a Trip's activity (#41) and Reminders (#42).
declare const self: ServiceWorkerGlobalScope;

// A new version waits until the "New version" toast asks it to take over.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});
clientsClaim();
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
// Every page is the app's, but for the API and the licenses file (`modules/client-licenses.ts`),
// which the server answers.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/'), {
    denylist: [/^\/api\//, /^\/licenses\.txt$/],
  }),
);

// A push about a Trip's activity, written in the browser's language and collapsed into the
// Trip's notification on screen, if there is one; or a Reminder, shown on its own; or, when
// the push is no PushMessage (e.g. from an older or newer server), a generic notification.
self.addEventListener('push', (event) => {
  const message = pushMessage(event.data?.text());
  event.waitUntil(
    (async () => {
      const [shown] = message
        ? await self.registration.getNotifications({ tag: activityTag(message.tripId) })
        : [];
      // SAFETY: every notification this worker shows carries NotificationData.
      const count = (shown?.data as NotificationData | undefined)?.count ?? 0;
      const locale = notificationLocale(self.navigator.languages);
      const { title, options } = notificationFor(message, count, locale);
      await self.registration.showNotification(title, options);
    })(),
  );
});

// Tapping opens the page the notification names: the Trip's Expenses, with the changed Expense
// highlighted unless collapsed, or Balances with the Reminder's suggestion highlighted. In the
// app's window if one is open (`notifications.client.ts` navigates it), else in a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // SAFETY: every notification this worker shows carries NotificationData.
  const { url } = event.notification.data as NotificationData;
  event.waitUntil(
    (async () => {
      const [open] = await self.clients.matchAll({ type: 'window' });
      if (!open) {
        await self.clients.openWindow(url);
        return;
      }
      open.postMessage({ type: 'openNotification', url });
      await open.focus();
    })(),
  );
});

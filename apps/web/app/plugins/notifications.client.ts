import { z } from 'zod';

// What the service worker asks of an open window when a notification is tapped (#41): to
// open the Trip page it names, e.g. its Expenses with the changed one highlighted.
const openMessageSchema = z.object({ type: z.literal('openNotification'), url: z.string() });

// Push notifications in the app's window (#41): opens what a tapped notification names, and
// on app open takes the browser's push subscription as it is now, while a Trip has them on.
// The browser may have renewed or dropped it meanwhile; sync then gives the server the new one.
export default defineNuxtPlugin(() => {
  navigator.serviceWorker?.addEventListener('message', (event) => {
    const message = openMessageSchema.safeParse(event.data);
    // Only a path of this app: never somewhere else.
    if (message.success && message.data.url.startsWith('/')) void navigateTo(message.data.url);
  });

  const device = useDevice();
  async function renew(): Promise<void> {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const trips = await device.readAll();
    if (!trips.some(({ deviceTrip }) => deviceTrip.notifications.subscription)) return;
    await device.renewSubscription(await browserSubscription());
  }
  // Best effort: without a connection it is tried again on the next open.
  void renew().catch(() => {});
});

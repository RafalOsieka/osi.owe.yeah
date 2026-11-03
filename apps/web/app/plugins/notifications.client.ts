import { z } from 'zod';

// What the service worker asks of an open window when a notification is tapped (#41): to
// open the Trip page it names, e.g. its Expenses with the changed one highlighted.
const openMessageSchema = z.object({ type: z.literal('openNotification'), url: z.string() });

export default defineNuxtPlugin(() => {
  navigator.serviceWorker?.addEventListener('message', (event) => {
    const message = openMessageSchema.safeParse(event.data);
    // Only a path of this app: never somewhere else.
    if (message.success && message.data.url.startsWith('/')) void navigateTo(message.data.url);
  });
});

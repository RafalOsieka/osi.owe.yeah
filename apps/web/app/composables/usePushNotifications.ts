import { pushKeyResponseSchema, subscriptionRequestSchema } from '@osi/owe-yeah-domain';
import type { BrowserSubscription } from '~/sync/db';

/**
 * Whether this browser can get push notifications: it can (`available`), the person blocked
 * them for the app (`denied`), it is iOS outside the installed app, where only the installed
 * app can (`homeScreen`), or it has no web push at all (`unsupported`).
 */
export type PushSupport = 'available' | 'denied' | 'homeScreen' | 'unsupported';

/**
 * How asking the browser for a push subscription went: it gave one, the person blocked
 * notifications or closed the prompt, or something else failed, e.g. no connection.
 */
export type Subscribed =
  | { status: 'subscribed'; subscription: BrowserSubscription }
  | { status: 'denied' | 'dismissed' | 'failed' };

function currentSupport(installed: boolean): PushSupport {
  const ios =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    // iPadOS says it is a Mac, but Macs have no touch screen.
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  if (ios && !installed) return 'homeScreen';
  if (
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    !('Notification' in window)
  ) {
    return 'unsupported';
  }
  return Notification.permission === 'denied' ? 'denied' : 'available';
}

/** The bytes of a VAPID key, base64url, as the browser takes and gives it. */
function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const base64 = key.replaceAll('-', '+').replaceAll('_', '/');
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

const sameKey = (a: ArrayBuffer | null, b: Uint8Array) =>
  a !== null &&
  a.byteLength === b.byteLength &&
  new Uint8Array(a).every((byte, i) => byte === b[i]);

/**
 * The browser's side of push notifications (#41): whether it can get them (`support`), and
 * `subscribe`, which asks the browser's permission and then its push subscription with the
 * server's VAPID key. Only ask from a tap: browsers refuse to prompt otherwise. The browser
 * has one subscription for the whole app, so every Trip shares it, and turning one Trip off
 * keeps it.
 */
export function usePushNotifications() {
  const { $pwa } = useNuxtApp();
  const installed = () => !!$pwa?.isPWAInstalled;
  const support = ref<PushSupport>(currentSupport(installed()));

  async function subscribe(): Promise<Subscribed> {
    try {
      const permission = await Notification.requestPermission();
      support.value = currentSupport(installed());
      if (permission !== 'granted') {
        return { status: permission === 'denied' ? 'denied' : 'dismissed' };
      }

      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) return { status: 'failed' };
      const { publicKey } = pushKeyResponseSchema.parse(await syncApi('/api/push-key'));
      const applicationServerKey = keyBytes(publicKey);
      let subscription = await registration.pushManager.getSubscription();
      // Subscribed with an older key of the server's: only a new subscription takes the new one.
      if (
        subscription &&
        !sameKey(subscription.options.applicationServerKey, applicationServerKey)
      ) {
        await subscription.unsubscribe();
        subscription = null;
      }
      subscription ??= await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
      const { endpoint, keys } = subscription.toJSON();
      const parsed = subscriptionRequestSchema.omit({ claimId: true }).parse({ endpoint, keys });
      return { status: 'subscribed', subscription: parsed };
    } catch (error) {
      console.warn('Push notifications could not be turned on', error);
      return { status: 'failed' };
    }
  }

  return { support: readonly(support), subscribe };
}

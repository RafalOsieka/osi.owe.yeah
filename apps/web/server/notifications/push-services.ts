/** Hostname suffixes of the browsers' push services: Chrome, Firefox, Safari and Edge. */
const PUSH_SERVICE_HOSTS = [
  'fcm.googleapis.com',
  'push.services.mozilla.com',
  'push.apple.com',
  'notify.windows.com',
];

/**
 * Whether a push subscription's `endpoint` belongs to a known push service: https on the
 * default port, at one of their hosts or a subdomain of it. The server takes and sends to no
 * other endpoint (unless `notificationsAnyEndpoint`, in tests), so a device can't make it post
 * into the network it runs in. Server-only: adding a push service needs no new app version.
 */
export function isKnownPushService(endpoint: string): boolean {
  const url = URL.parse(endpoint);
  if (url?.protocol !== 'https:' || url.port !== '') return false;
  const { hostname } = url;
  return PUSH_SERVICE_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

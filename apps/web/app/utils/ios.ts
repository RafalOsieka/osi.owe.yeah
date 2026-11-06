/**
 * Whether the device is an iPhone, iPad or iPod: Safari there has no install prompt, so the app
 * says how to add it to the Home Screen, and only the installed app gets push notifications.
 * Pass `navigator`. iPadOS says it is a Mac, but Macs have no touch screen.
 */
export function isIos({
  userAgent,
  maxTouchPoints,
}: Pick<Navigator, 'userAgent' | 'maxTouchPoints'>): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

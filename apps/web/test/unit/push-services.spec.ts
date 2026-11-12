import { describe, expect, it } from 'vitest';
import { isKnownPushService } from '../../server/notifications/push-services';

describe('isKnownPushService', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://push.apple.com/abc',
    'https://web.push.apple.com/abc',
    'https://notify.windows.com/w/?token=abc',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
    'https://push.services.mozilla.com/abc',
    'https://sub.fcm.googleapis.com/abc',
    'https://FCM.googleapis.com:443/abc',
  ])('takes %s, at a known push service', (endpoint) => {
    expect(isKnownPushService(endpoint)).toBe(true);
  });

  it.each([
    'https://fcm.googleapis.com.evil.example/abc',
    'https://evilfcm.googleapis.com/abc',
    'https://googleapis.com/abc',
    'http://fcm.googleapis.com/abc',
    'https://fcm.googleapis.com:8443/abc',
    'https://127.0.0.1/abc',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/abc',
    'https://localhost/abc',
    'not a url',
  ])('refuses %s', (endpoint) => {
    expect(isKnownPushService(endpoint)).toBe(false);
  });
});

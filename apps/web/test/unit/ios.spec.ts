import { describe, expect, it } from 'vitest';
import { isIos } from '../../app/utils/ios';

const iphone =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const ipad =
  'Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
// What iPadOS Safari and desktop Safari on a Mac both send.
const mac =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15';

describe('isIos', () => {
  it('knows an iPhone', () => {
    expect(isIos({ userAgent: iphone, maxTouchPoints: 5 })).toBe(true);
  });

  it('knows an iPad that says it is one', () => {
    expect(isIos({ userAgent: ipad, maxTouchPoints: 5 })).toBe(true);
  });

  it('knows iPadOS, which says it is a Mac but has a touch screen', () => {
    expect(isIos({ userAgent: mac, maxTouchPoints: 5 })).toBe(true);
  });

  it('leaves a Mac without touch alone', () => {
    expect(isIos({ userAgent: mac, maxTouchPoints: 0 })).toBe(false);
  });
});

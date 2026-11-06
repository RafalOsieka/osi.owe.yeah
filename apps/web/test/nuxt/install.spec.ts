import { fromPartial } from '@total-typescript/shoehorn';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import InstallNudge from '../../app/components/InstallNudge.vue';
import InstallRow from '../../app/components/InstallRow.vue';

// What the PWA module tells the app; each test sets the browser it plays.
const pwa = vi.hoisted(() => ({
  state: { isPWAInstalled: false, showInstallPrompt: false },
  install: vi.fn(),
}));
mockNuxtImport('usePWA', () => () => fromPartial(reactive({ ...pwa.state, install: pwa.install })));

const chrome =
  'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const iphone =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
// What iPadOS Safari and desktop Safari on a Mac both send.
const mac =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15';

function browser(userAgent: string, maxTouchPoints = 0): void {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  vi.spyOn(navigator, 'maxTouchPoints', 'get').mockReturnValue(maxTouchPoints);
}

beforeEach(() => {
  pwa.state = { isPWAInstalled: false, showInstallPrompt: false };
  pwa.install.mockReset();
  browser(chrome);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the Install row on the Trip tab', () => {
  it("opens the browser's install prompt where the browser has one", async () => {
    pwa.state.showInstallPrompt = true;
    const row = await mountSuspended(InstallRow);

    expect(row.text()).toContain('Install Owe Yeah');
    await row.get('button').trigger('click');
    expect(pwa.install).toHaveBeenCalledOnce();
  });

  it.each([
    ['iPhone', iphone, 5],
    ['iPadOS, which says it is a Mac', mac, 5],
  ])('says how to add the app to the Home Screen on %s', async (_, userAgent, touchPoints) => {
    browser(userAgent, touchPoints);
    const row = await mountSuspended(InstallRow);

    expect(row.text()).toContain('Install Owe Yeah');
    expect(row.text()).toMatch(/Tap\s+Share, then Add to Home Screen/);
  });

  it('is absent once the app is installed', async () => {
    pwa.state = { isPWAInstalled: true, showInstallPrompt: true };
    browser(iphone, 5);
    const row = await mountSuspended(InstallRow);

    expect(row.text()).toBe('');
  });

  it('is absent on a browser that offers no install', async () => {
    browser(mac);
    const row = await mountSuspended(InstallRow);

    expect(row.text()).toBe('');
  });
});

describe('the install nudge on My Trips', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('says how to add the app to the Home Screen on iPadOS too', async () => {
    browser(mac, 5);
    const nudge = await mountSuspended(InstallNudge);

    expect(nudge.text()).toMatch(/Tap\s+Share, then Add to Home Screen/);
  });

  it('leaves the Install row on the Trip tab once dismissed', async () => {
    pwa.state.showInstallPrompt = true;
    const nudge = await mountSuspended(InstallNudge);
    await nudge.get('button[aria-label="Close"]').trigger('click');

    expect(nudge.text()).toBe('');
    expect((await mountSuspended(InstallNudge)).text()).toBe('');
    expect((await mountSuspended(InstallRow)).text()).toContain('Install Owe Yeah');
  });
});

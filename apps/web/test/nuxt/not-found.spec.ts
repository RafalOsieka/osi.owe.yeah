import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, it } from 'vitest';
import App from '../../app/app.vue';

describe('an unknown path', () => {
  afterEach(async () => {
    await useNuxtApp().$i18n.setLocale('en');
  });

  it('says the page does not exist, in the app layout, with a way to My Trips', async () => {
    const wrapper = await mountSuspended(App, { route: '/nonexistent-page' });

    expect(wrapper.find('header').text()).toContain('Owe Yeah');
    expect(wrapper.find('main h1').text()).toBe("This page doesn't exist.");
    expect(wrapper.find('main a[href="/"]').text()).toBe('My Trips');
  });

  it("says so in the device language, also under a real page's path", async () => {
    await useNuxtApp().$i18n.setLocale('pl');

    const wrapper = await mountSuspended(App, { route: '/trips/new/nonexistent' });

    expect(wrapper.find('main h1').text()).toBe('Ta strona nie istnieje.');
    expect(wrapper.find('main a[href="/"]').text()).toBe('Moje podróże');
  });
});

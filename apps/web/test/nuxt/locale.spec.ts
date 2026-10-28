import { afterEach, describe, expect, it } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import App from '../../app/app.vue';

describe('app locale', () => {
  afterEach(async () => {
    await useNuxtApp().$i18n.setLocale('en');
  });

  it('renders the shell in Polish once the locale is pl', async () => {
    const wrapper = await mountSuspended(App, { route: '/' });
    expect(wrapper.text()).toContain('My Trips');

    await useNuxtApp().$i18n.setLocale('pl');
    await nextTick();

    expect(wrapper.text()).toContain('Moje wyjazdy');
  });
});

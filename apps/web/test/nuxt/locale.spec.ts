import { afterEach, describe, expect, it } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import App from '../../app/app.vue';

describe('app locale', () => {
  afterEach(async () => {
    await useNuxtApp().$i18n.setLocale('en');
  });

  it('marks the document as Polish once the locale is pl', async () => {
    await mountSuspended(App, { route: '/' });
    await expect.poll(() => document.documentElement.lang).toBe('en');

    await useNuxtApp().$i18n.setLocale('pl');

    await expect.poll(() => document.documentElement.lang).toBe('pl');
  });
});

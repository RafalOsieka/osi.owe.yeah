<script setup lang="ts">
import * as locales from '@nuxt/ui/locale';

const { t, locale } = useI18n();

// Nuxt UI's own strings (aria labels, color mode button) follow the app locale.
const uiLocale = computed(() => locales[locale.value]);

useHead({
  htmlAttrs: {
    lang: locale,
    dir: computed(() => uiLocale.value.dir),
  },
  // The logo's tab and home-screen icons (`app/assets/icons/app-mark.svg` lists them). Browsers
  // without SVG favicons take the `.ico`; its `sizes` keeps Chrome from preferring it.
  link: [
    { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
    { rel: 'icon', href: '/favicon.ico', sizes: '32x32' },
    { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
  ],
  titleTemplate: (pageTitle) => (pageTitle ? `${pageTitle} | ${t('app.title')}` : t('app.title')),
});

useAppUpdatePrompt();
</script>

<template>
  <UApp :locale="uiLocale">
    <NuxtRouteAnnouncer />
    <NuxtPwaManifest />
    <!-- A phone app first: wide screens get the same layout in a centered column. Each page
         wraps itself in its layout (`<NuxtLayout name>`), so layouts can take a title and a
         fixed action. A test environment's banner tops every page. The column stacks the
         banner and the layout's parts, so a layout can fill the screen's height under them. -->
    <div class="min-h-dvh bg-accented/60">
      <div
        class="mx-auto flex min-h-dvh max-w-120 flex-col bg-canvas ps-[env(safe-area-inset-left)] pe-[env(safe-area-inset-right)]"
      >
        <TestEnvironmentBanner />
        <NuxtPage />
      </div>
    </div>
  </UApp>
</template>

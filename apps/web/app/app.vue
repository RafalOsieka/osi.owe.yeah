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
  titleTemplate: (pageTitle) => (pageTitle ? `${pageTitle} | ${t('app.title')}` : t('app.title')),
});
</script>

<template>
  <UApp :locale="uiLocale">
    <NuxtRouteAnnouncer />
    <NuxtPwaManifest />
    <!-- A phone app first: wide screens get the same layout in a centered column. Each page
         wraps itself in its layout (`<NuxtLayout name>`), so layouts can take a title and a
         fixed action. -->
    <div class="min-h-dvh bg-muted">
      <div
        class="mx-auto min-h-dvh max-w-120 bg-default ps-[env(safe-area-inset-left)] pe-[env(safe-area-inset-right)]"
      >
        <NuxtPage />
      </div>
    </div>
  </UApp>
</template>

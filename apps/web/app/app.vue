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
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>

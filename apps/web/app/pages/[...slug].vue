<script setup lang="ts">
// Any path no other page matches: says the page doesn't exist, in the app's layout and
// language, and leads to My Trips. Without it, Nuxt shows its own untranslated error page.
const { t } = useI18n();
useHead({ title: () => t('notFound.title') });
</script>

<template>
  <NuxtLayout name="default">
    <UEmpty
      icon="i-lucide-map-pin-off"
      :title="$t('notFound.title')"
      :description="$t('notFound.help')"
      :actions="[{ label: $t('myTrips.title'), to: '/', icon: 'i-lucide-house' }]"
    />
  </NuxtLayout>
</template>

<script setup lang="ts">
// Placeholder landing route; the Trip list arrives with Trip creation.
const { t } = useI18n();

useHead({ title: () => t('trips.title') });
</script>

<template>
  <UPage>
    <UPageHeader :title="$t('trips.title')" />
    <UPageBody>
      <UEmpty icon="i-lucide-map" :title="$t('trips.empty')" />
    </UPageBody>
  </UPage>
</template>

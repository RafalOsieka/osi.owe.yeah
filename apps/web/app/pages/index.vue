<script setup lang="ts">
// Placeholder landing route; the list of Trips opened on this device arrives with the
// device's local Trip store.
const { t } = useI18n();

useHead({ title: () => t('myTrips.title') });
</script>

<template>
  <UPage>
    <UPageHeader :title="$t('myTrips.title')" />
    <UPageBody>
      <UEmpty
        icon="i-lucide-map"
        :title="$t('myTrips.empty')"
        :actions="[{ label: $t('myTrips.create'), icon: 'i-lucide-plus', to: '/trips/new' }]"
      />
    </UPageBody>
  </UPage>
</template>

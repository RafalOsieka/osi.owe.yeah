<script setup lang="ts">
// Placeholder landing route; the list of Trips opened on this device arrives with the
// device's local Trip store.
const { t } = useI18n();

useHead({ title: () => t('trips.title') });
</script>

<template>
  <UPage>
    <UPageHeader :title="$t('trips.title')" />
    <UPageBody>
      <UEmpty
        icon="i-lucide-map"
        :title="$t('trips.empty')"
        :actions="[{ label: $t('trips.create'), icon: 'i-lucide-plus', to: '/trips/new' }]"
      />
    </UPageBody>
  </UPage>
</template>

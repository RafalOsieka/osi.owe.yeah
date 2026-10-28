<script setup lang="ts">
// My Trips: every Trip opened on this device, most recent first, with its Claim.
const { t } = useI18n();
const { opened } = useDeviceTrips();

useHead({ title: () => t('myTrips.title') });
</script>

<template>
  <UPage>
    <UPageHeader :title="$t('myTrips.title')">
      <template v-if="opened.length > 0" #links>
        <UButton icon="i-lucide-plus" :label="$t('myTrips.create')" to="/trips/new" />
      </template>
    </UPageHeader>
    <UPageBody>
      <ul v-if="opened.length > 0" class="space-y-3">
        <li v-for="trip in opened" :key="trip.id">
          <UPageCard
            :title="trip.name"
            :description="
              trip.claim ? $t('claim.youAre', { name: trip.claim.name }) : $t('myTrips.noClaim')
            "
            :to="{ path: `/trips/${trip.id}`, hash: `#${trip.token}` }"
            icon="i-lucide-map"
          />
        </li>
      </ul>
      <UEmpty
        v-else
        icon="i-lucide-map"
        :title="$t('myTrips.empty')"
        :actions="[{ label: $t('myTrips.create'), icon: 'i-lucide-plus', to: '/trips/new' }]"
      />
    </UPageBody>
  </UPage>
</template>

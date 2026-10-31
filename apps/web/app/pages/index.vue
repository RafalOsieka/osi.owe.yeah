<script setup lang="ts">
// My Trips: every Trip opened on this device, most recent first, with its Claim.
const { t } = useI18n();
const { opened } = useDeviceTrips();

useHead({ title: () => t('myTrips.title') });
</script>

<template>
  <NuxtLayout name="default">
    <h1 class="sr-only">{{ $t('myTrips.title') }}</h1>
    <ul v-if="opened.length > 0" class="space-y-2.5">
      <li v-for="trip in opened" :key="trip.id">
        <NuxtLink
          :to="`/trips/${trip.id}`"
          class="flex items-center gap-3 rounded-xl border border-default p-3 hover:bg-elevated/50"
        >
          <span
            class="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
          >
            <UIcon name="i-lucide-map" class="size-5" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate font-semibold">{{ trip.name }}</span>
            <span class="block truncate text-sm text-muted">
              {{ trip.claim ? $t('claim.youAre', { name: trip.claim.name }) : $t('claim.title') }}
            </span>
          </span>
        </NuxtLink>
      </li>
    </ul>
    <UEmpty
      v-else
      icon="i-lucide-map"
      variant="naked"
      :title="$t('myTrips.empty')"
      :actions="[{ label: $t('myTrips.create'), icon: 'i-lucide-plus', to: '/trips/new' }]"
      class="pt-16"
    />

    <template v-if="opened.length > 0" #action>
      <UButton
        icon="i-lucide-plus"
        :label="$t('myTrips.create')"
        to="/trips/new"
        size="xl"
        class="rounded-2xl shadow-lg"
      />
    </template>
  </NuxtLayout>
</template>

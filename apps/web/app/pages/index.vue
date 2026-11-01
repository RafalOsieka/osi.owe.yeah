<script setup lang="ts">
import { balances, isSettled } from '@osi/owe-yeah-domain';

// My Trips: every Trip on this device, most recently opened first and Settled ones below the
// rest, with its Claim, your balance there (or a Settled badge), and how many of your
// changes haven't synced yet.
const { t, locale } = useI18n();
const device = useDevice();
const trips = useLiveQuery(() => device.readAll());

const rows = computed(() =>
  (trips.value ?? [])
    .flatMap(({ deviceTrip: { id, claim }, local, unsynced }) => {
      // A Trip moved over from before the device store shows once it has been pulled.
      if (!local) return [];
      const settled = isSettled(local);
      const mine =
        !settled &&
        claim &&
        balances(local).find(({ participantId }) => participantId === claim.id);
      const sign = mine ? shownSign(mine.rounded, local.currency) : 0;
      return [
        {
          id,
          name: local.name,
          claim,
          unsynced,
          settled,
          balance: mine && {
            text: formatMoney(mine.rounded, local.currency, locale.value, 'signedCurrency'),
            tone: sign > 0 ? 'text-primary' : sign < 0 ? 'text-error' : 'text-muted',
          },
        },
      ];
    })
    // Stable, so each group keeps the most recently opened first.
    .toSorted((a, b) => Number(a.settled) - Number(b.settled)),
);

useHead({ title: () => t('myTrips.title') });
</script>

<template>
  <NuxtLayout name="default">
    <h1 class="sr-only">{{ $t('myTrips.title') }}</h1>
    <ul v-if="rows.length > 0" class="space-y-2.5">
      <li v-for="trip in rows" :key="trip.id">
        <NuxtLink
          :to="`/trips/${trip.id}`"
          class="flex items-center gap-3 rounded-xl border border-default p-3 hover:bg-elevated/50"
          :class="{ 'opacity-70': trip.settled }"
        >
          <span
            class="grid size-10 shrink-0 place-items-center rounded-lg"
            :class="trip.settled ? 'bg-accented text-muted' : 'bg-primary/10 text-primary'"
          >
            <UIcon :name="trip.settled ? 'i-lucide-check' : 'i-lucide-map'" class="size-5" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate font-semibold">{{ trip.name }}</span>
            <span class="block truncate text-sm text-muted">
              {{ trip.claim ? $t('claim.youAre', { name: trip.claim.name }) : $t('claim.title') }}
              <span v-if="trip.unsynced > 0" class="text-warning">
                {{ $t('sync.unsyncedShort', { count: trip.unsynced }) }}
              </span>
            </span>
          </span>
          <UBadge
            v-if="trip.settled"
            :label="$t('myTrips.settled')"
            color="success"
            variant="subtle"
            class="shrink-0"
          />
          <span
            v-else-if="trip.balance"
            class="shrink-0 font-semibold tabular-nums"
            :class="trip.balance.tone"
          >
            {{ trip.balance.text }}
          </span>
        </NuxtLink>
      </li>
    </ul>
    <UEmpty
      v-else-if="trips"
      icon="i-lucide-map"
      variant="naked"
      :title="$t('myTrips.empty')"
      :actions="[{ label: $t('myTrips.create'), icon: 'i-lucide-plus', to: '/trips/new' }]"
      class="pt-16"
    />

    <template v-if="rows.length > 0" #action>
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

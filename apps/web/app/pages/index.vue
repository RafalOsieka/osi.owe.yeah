<script setup lang="ts">
import { balances, isSettled, rational, type Rational } from '@osi/owe-yeah-domain';

// My Trips: every Trip on this device, most recently opened first and Settled ones below the
// rest, with its Claim, your balance there (or a Settled badge), and how many of your
// changes haven't synced yet. Above them, the install nudge; below, the privacy notice and the
// terms. A first visit gets a welcome with "New Trip" instead.
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
            text: formatMoney(abs(mine.rounded), local.currency, locale.value),
            label:
              sign > 0 ? t('balances.owed') : sign < 0 ? t('balances.owe') : t('balances.even'),
            tone: sign > 0 ? 'text-success' : sign < 0 ? 'text-error' : 'text-muted',
          },
        },
      ];
    })
    // Stable, so each group keeps the most recently opened first.
    .toSorted((a, b) => Number(a.settled) - Number(b.settled)),
);

const abs = ({ numerator, denominator }: Rational) =>
  rational(numerator < 0n ? -numerator : numerator, denominator);

useHead({ title: () => t('myTrips.title') });
</script>

<template>
  <NuxtLayout name="default">
    <h1
      v-if="rows.length > 0"
      class="mt-2 mb-5 px-1 text-3xl font-semibold tracking-tight text-highlighted"
    >
      {{ $t('myTrips.title') }}
    </h1>
    <h1 v-else class="sr-only">{{ $t('myTrips.title') }}</h1>
    <!-- Once there are Trips to keep safe: a first visit gets "New Trip" alone. -->
    <InstallNudge v-if="rows.length > 0" />
    <ul v-if="rows.length > 0" class="space-y-3">
      <li v-for="trip in rows" :key="trip.id">
        <NuxtLink
          :to="`/trips/${trip.id}`"
          class="card flex items-center gap-3.5 p-4 transition-colors hover:bg-elevated/40 active:bg-elevated/70"
        >
          <span
            class="grid size-12 shrink-0 place-items-center rounded-[0.875rem]"
            :class="
              trip.settled
                ? 'bg-elevated text-muted'
                : 'bg-linear-to-br from-primary-400 to-primary-600 text-white shadow-sm shadow-primary-600/25'
            "
          >
            <UIcon :name="trip.settled ? 'i-lucide-check' : 'i-lucide-plane'" class="size-6" />
          </span>
          <span class="min-w-0 flex-1">
            <span
              class="block truncate text-lg font-semibold tracking-tight"
              :class="trip.settled ? 'text-muted' : 'text-highlighted'"
            >
              {{ trip.name }}
            </span>
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
            color="neutral"
            variant="soft"
            icon="i-lucide-circle-check"
            class="shrink-0 rounded-full"
          />
          <span v-else-if="trip.balance" class="shrink-0 text-end">
            <span class="block text-xs text-muted">{{ trip.balance.label }}</span>
            <span class="block font-semibold tabular-nums" :class="trip.balance.tone">
              {{ trip.balance.text }}
            </span>
          </span>
        </NuxtLink>
      </li>
    </ul>
    <div v-else-if="trips" class="flex flex-col items-center px-4 pt-20 text-center">
      <span
        class="grid size-24 place-items-center rounded-[1.75rem] bg-linear-to-br from-primary-400 to-primary-600 text-white shadow-xl shadow-primary-600/25"
        aria-hidden="true"
      >
        <AppBrandMark class="size-14 text-white" />
      </span>
      <p class="mt-8 text-2xl font-semibold tracking-tight text-highlighted">
        {{ $t('myTrips.empty') }}
      </p>
      <p class="mt-2 max-w-72 text-muted">{{ $t('myTrips.emptyHelp') }}</p>
      <UButton
        icon="i-lucide-plus"
        :label="$t('myTrips.create')"
        to="/trips/new"
        size="xl"
        class="mt-8 rounded-full px-6 shadow-lg shadow-primary/25"
      />
    </div>
    <LegalLinks class="mt-10" />

    <template v-if="rows.length > 0" #action>
      <UButton
        icon="i-lucide-plus"
        :label="$t('myTrips.create')"
        to="/trips/new"
        size="xl"
        class="rounded-full px-5 shadow-lg shadow-primary/30"
      />
    </template>
  </NuxtLayout>
</template>

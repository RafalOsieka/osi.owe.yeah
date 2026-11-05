<script setup lang="ts">
import {
  balances,
  groupByLocalDay,
  isSettled,
  rational,
  type Rational,
} from '@osi/owe-yeah-domain';

// My Trips: every Trip on this device, most recently opened first and Settled ones below the
// rest, with the faces of its first Participants, when its Expenses were (or its Claim before
// there are any, or "Who are you?" without one), your balance there (or a Settled badge), and
// how many of your changes haven't synced yet. Above them, the install nudge; below, the privacy notice and the
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
          // The first few faces of who is in it.
          people: local.participants.slice(0, 4),
          more: Math.max(0, local.participants.length - 4),
          dates: dateRange(local.expenses),
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

// When the Trip's Expenses were, e.g. "Jul 3 – 5", from their local days; `null` without any.
// The days are calendar dates, so they are formatted in UTC to keep the device's zone out.
function dateRange(expenses: Parameters<typeof groupByLocalDay>[0]): string | null {
  const days = groupByLocalDay(expenses);
  const last = days.at(0)?.day;
  const first = days.at(-1)?.day;
  if (!first || !last) return null;
  const format = new Intl.DateTimeFormat(locale.value, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  return format.formatRange(new Date(`${first}T00:00:00Z`), new Date(`${last}T00:00:00Z`));
}

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
            :class="trip.settled ? 'bg-success/12 text-success' : 'bg-primary/12 text-primary'"
          >
            <UIcon :name="trip.settled ? 'i-lucide-check' : 'i-lucide-plane'" class="size-6" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-lg font-semibold tracking-tight text-highlighted">
              {{ trip.name }}
            </span>
            <span class="mt-1 flex min-w-0 items-center gap-2 text-sm text-muted">
              <span class="flex shrink-0" aria-hidden="true">
                <ParticipantAvatar
                  v-for="(person, index) in trip.people"
                  :key="person.id"
                  :participant="person"
                  :index="index"
                  size="xs"
                  class="ring-2 ring-(--ui-bg)"
                  :class="{ '-ms-1': index > 0 }"
                />
                <span
                  v-if="trip.more > 0"
                  class="-ms-1 grid h-6 min-w-6 place-items-center rounded-full bg-elevated px-1 text-[0.625rem] font-semibold ring-2 ring-(--ui-bg)"
                >
                  +{{ trip.more }}
                </span>
              </span>
              <span class="truncate">
                {{
                  !trip.claim
                    ? $t('claim.title')
                    : (trip.dates ?? $t('claim.youAre', { name: trip.claim.name }))
                }}
                <span v-if="trip.unsynced > 0" class="text-warning">
                  {{ $t('sync.unsyncedShort', { count: trip.unsynced }) }}
                </span>
              </span>
            </span>
          </span>
          <UBadge
            v-if="trip.settled"
            :label="$t('myTrips.settled')"
            color="success"
            variant="soft"
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
    <div
      v-else-if="trips"
      class="flex min-h-[calc(100dvh-12rem)] flex-col items-center justify-center px-4 text-center"
    >
      <span
        class="grid size-24 place-items-center rounded-[1.75rem] bg-linear-to-br from-primary-400 to-primary-600 text-white shadow-xl shadow-primary-600/25 dark:shadow-none"
        aria-hidden="true"
      >
        <UIcon name="i-lucide-luggage" class="size-12" />
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
        class="mt-8 rounded-full px-6 shadow-lg shadow-primary/25 dark:shadow-none"
      />
    </div>
    <LegalLinks class="mt-auto pt-10" />

    <template v-if="rows.length > 0" #action>
      <UButton
        icon="i-lucide-plus"
        :label="$t('myTrips.create')"
        to="/trips/new"
        size="xl"
        class="rounded-full px-5 shadow-lg shadow-primary/30 dark:shadow-black/40"
      />
    </template>
  </NuxtLayout>
</template>

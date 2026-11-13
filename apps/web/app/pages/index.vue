<script setup lang="ts">
import { absolute, balances, groupByLocalDay, isSettled } from '@osi/owe-yeah-domain';

// My Trips: every Trip on this device, most recently opened first, and Settled ones in their
// own group below the rest. Each row has the Trip's initial on its own tint (none repeated
// while one is free), so Trips tell apart at a glance, the faces of its first Participants, when its Expenses were (or "No
// Expenses yet"), your balance there under the name you are in it, e.g. "Ania owes" (or "Who
// are you?" without a Claim), and how many of your changes haven't synced yet. Above them,
// the install nudge; below, the privacy notice and the terms. A first visit gets a welcome
// saying what the app does, with "New Trip".
const { t, locale } = useI18n();
const device = useDevice();
const trips = useLiveQuery(() => device.readAll());

// Each Trip's tile tint, different for every Trip on this device while a free one is left.
const tints = computed(() => distinctAvatarColors((trips.value ?? []).map(({ id }) => id)));

const rows = computed(() =>
  (trips.value ?? []).flatMap(({ id, claim, trip: local, unsynced }) => {
    // A Trip moved over from before the device store shows once it has been pulled.
    if (!local) return [];
    const settled = isSettled(local);
    const dates = dateRange(local.expenses);
    const mine = claim && balances(local).find(({ participantId }) => participantId === claim.id);
    const sign = mine ? shownSign(mine.rounded, local.currency) : 0;
    // The right side: your balance, or that you haven't said who you are.
    const balance = (): { label: string; text: string | null; tone: string } | null => {
      if (settled || !dates) return null;
      if (!claim) return { label: t('claim.title'), text: null, tone: '' };
      const { name } = claim;
      if (!mine || sign === 0) return { label: t('myTrips.even', { name }), text: null, tone: '' };
      return {
        label: sign > 0 ? t('myTrips.owed', { name }) : t('myTrips.owes', { name }),
        text: formatMoney(absolute(mine.rounded), local.currency, locale.value),
        tone: sign > 0 ? 'text-success' : 'text-error',
      };
    };
    return [
      {
        id,
        name: local.name,
        initial: Array.from(local.name)[0]?.toLocaleUpperCase() ?? '',
        tint: tints.value.get(id) ?? avatarColor(id),
        unsynced,
        settled,
        // The first few faces of who is in it.
        people: local.participants.slice(0, 4),
        colors: participantAvatarColors(local),
        more: Math.max(0, local.participants.length - 4),
        when: dates ?? t('myTrips.noExpenses'),
        balance: balance(),
      },
    ];
  }),
);
// The Trips still going, then the Settled ones under their own heading.
const groups = computed(() =>
  [
    { id: 'active', heading: null, rows: rows.value.filter(({ settled }) => !settled) },
    {
      id: 'settled',
      heading: t('myTrips.settledHeading'),
      rows: rows.value.filter(({ settled }) => settled),
    },
  ].filter((group) => group.rows.length > 0),
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

useHead({ title: () => t('myTrips.title') });
</script>

<template>
  <NuxtLayout name="default" :title="rows.length > 0 ? $t('myTrips.title') : null">
    <h1 v-if="rows.length === 0" class="sr-only">{{ $t('myTrips.title') }}</h1>
    <!-- Once there are Trips to keep safe: a first visit gets "New Trip" alone. -->
    <template v-if="rows.length > 0">
      <InstallNudge class="mb-3" />
      <section
        v-for="group in groups"
        :key="group.id"
        :aria-labelledby="group.heading ? `${group.id}-heading` : undefined"
        class="not-first-of-type:mt-7"
      >
        <h2 v-if="group.heading" :id="`${group.id}-heading`" class="section-heading">
          {{ group.heading }}
        </h2>
        <ul class="space-y-3">
          <li v-for="trip in group.rows" :key="trip.id">
            <NuxtLink
              :to="`/trips/${trip.id}`"
              class="card flex items-center gap-3.5 p-4 transition-colors hover:bg-elevated/40 active:bg-elevated/70"
            >
              <span
                class="grid size-12 shrink-0 place-items-center rounded-[0.875rem] text-xl font-semibold"
                :class="trip.settled ? 'bg-elevated text-muted' : trip.tint"
                aria-hidden="true"
              >
                {{ trip.initial }}
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
                      :color="trip.colors.get(person.id)"
                      size="xs"
                      class="ring-2 ring-(--ui-bg)"
                      :class="{ '-ms-1': index > 0 }"
                    />
                    <span
                      v-if="trip.more > 0"
                      class="-ms-1 grid h-6 min-w-6 place-items-center rounded-full bg-elevated px-1 text-[0.6875rem] font-semibold ring-2 ring-(--ui-bg)"
                    >
                      +{{ trip.more }}
                    </span>
                  </span>
                  <span class="truncate">
                    {{ trip.when }}
                    <span v-if="trip.unsynced > 0" class="text-warning">
                      {{ $t('sync.unsyncedShort', { count: trip.unsynced }) }}
                    </span>
                  </span>
                </span>
              </span>
              <span v-if="trip.balance" class="shrink-0 text-end">
                <span class="block max-w-36 truncate text-sm text-muted">
                  {{ trip.balance.label }}
                </span>
                <span
                  v-if="trip.balance.text"
                  class="block font-semibold tabular-nums"
                  :class="trip.balance.tone"
                >
                  {{ trip.balance.text }}
                </span>
              </span>
            </NuxtLink>
          </li>
        </ul>
      </section>
    </template>
    <div
      v-else-if="trips"
      class="flex flex-1 flex-col items-center justify-center px-4 py-10 text-center"
    >
      <span
        class="grid size-20 place-items-center rounded-3xl bg-primary/10 text-primary"
        aria-hidden="true"
      >
        <UIcon name="i-lucide-luggage" class="size-9" />
      </span>
      <p class="mt-6 text-sm font-medium text-muted">{{ $t('myTrips.empty') }}</p>
      <p class="mt-1 text-2xl font-semibold tracking-tight text-balance text-highlighted">
        {{ $t('myTrips.welcome') }}
      </p>
      <p class="mt-2 max-w-80 text-balance text-muted">{{ $t('myTrips.emptyHelp') }}</p>
      <UButton
        icon="i-lucide-plus"
        :label="$t('myTrips.create')"
        to="/trips/new"
        size="xl"
        class="mt-8 px-6"
      />
    </div>
    <LegalLinks class="mt-auto pt-10" />

    <template v-if="rows.length > 0" #action>
      <UButton
        icon="i-lucide-plus"
        :label="$t('myTrips.create')"
        to="/trips/new"
        size="xl"
        class="px-5 shadow-lg shadow-black/15 dark:shadow-black/40"
      />
    </template>
  </NuxtLayout>
</template>

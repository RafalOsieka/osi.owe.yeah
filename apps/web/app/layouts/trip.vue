<script setup lang="ts">
// The Trip's tabs (Expenses · Balances · Trip): the Trip header on top with the sync status,
// the tab bar at the bottom and an optional `#action` floating just above it. Pulling a tab
// down syncs the Trip. Only for pages under `pages/trips/[id].vue`, which provides the open
// Trip.
const { trip, claim, unsynced, sync, askWhoYouAre } = useOpenTrip();
const { t } = useI18n();
const back = useBack();
const { pulled, ready, refreshing } = usePullToRefresh(sync);

const tabs = computed(() => {
  const base = `/trips/${trip.value.id}`;
  return [
    { label: t('expense.list'), icon: 'i-lucide-receipt-text', to: base },
    { label: t('balances.title'), icon: 'i-lucide-scale', to: `${base}/balances` },
    { label: t('trip.tab'), icon: 'i-lucide-settings', to: `${base}/settings` },
  ];
});
</script>

<template>
  <header
    class="sticky top-0 z-10 border-b border-default bg-default pt-[env(safe-area-inset-top)]"
  >
    <div class="flex h-14 items-center gap-1 px-2">
      <UButton
        icon="i-lucide-chevron-left"
        color="neutral"
        variant="ghost"
        :aria-label="$t('trip.backToMyTrips')"
        @click="back('/')"
      />
      <div class="min-w-0 flex-1 leading-tight">
        <h1 class="truncate text-base font-semibold">{{ trip.name }}</h1>
        <button
          type="button"
          class="block max-w-full cursor-pointer truncate text-xs text-muted hover:text-default"
          @click="askWhoYouAre"
        >
          {{
            $t('trip.subtitle', {
              who: claim ? $t('claim.youAre', { name: claim.name }) : $t('claim.title'),
              currency: trip.currency,
            })
          }}
        </button>
      </div>
      <UPopover :content="{ align: 'end' }">
        <UButton
          color="neutral"
          variant="ghost"
          :aria-label="$t('sync.unsynced', unsynced)"
          class="relative"
        >
          <UIcon :name="unsynced > 0 ? 'i-lucide-cloud' : 'i-lucide-cloud-check'" class="size-5" />
          <span
            v-if="unsynced > 0"
            class="absolute end-1.5 top-1.5 size-2 rounded-full bg-warning ring-2 ring-default"
          />
        </UButton>
        <template #content>
          <div class="max-w-64 p-3 text-sm">
            <p class="font-semibold">{{ $t('sync.unsynced', unsynced) }}</p>
            <p v-if="unsynced > 0" class="mt-1 text-muted">{{ $t('sync.unsyncedHelp') }}</p>
          </div>
        </template>
      </UPopover>
    </div>
  </header>
  <div
    v-if="pulled > 0 || refreshing"
    class="flex items-center justify-center gap-2 overflow-hidden text-xs text-muted"
    :style="{ height: refreshing ? '2.5rem' : `${pulled}px` }"
  >
    <UIcon
      name="i-lucide-refresh-cw"
      class="size-4 shrink-0"
      :class="{ 'animate-spin': refreshing }"
    />
    <span v-if="!refreshing">
      {{ ready ? $t('sync.releaseToRefresh') : $t('sync.pullToRefresh') }}
    </span>
  </div>
  <main class="px-4 pt-3 pb-[calc(10rem+env(safe-area-inset-bottom))]">
    <slot />
  </main>
  <div
    v-if="$slots.action"
    class="pointer-events-none fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 mx-auto flex max-w-120 justify-end p-4"
  >
    <div class="pointer-events-auto">
      <slot name="action" />
    </div>
  </div>
  <nav
    :aria-label="$t('trip.tabs')"
    class="fixed inset-x-0 bottom-0 z-10 mx-auto max-w-120 border-t border-default bg-default pb-[env(safe-area-inset-bottom)]"
  >
    <!-- Tabs replace each other in history, so back always leaves the Trip. -->
    <ul class="flex">
      <li v-for="tab in tabs" :key="tab.to" class="flex-1">
        <NuxtLink
          :to="tab.to"
          replace
          class="flex h-16 flex-col items-center justify-center gap-0.5 text-xs text-muted aria-[current=page]:font-semibold aria-[current=page]:text-primary"
        >
          <UIcon :name="tab.icon" class="size-6" />
          {{ tab.label }}
        </NuxtLink>
      </li>
    </ul>
  </nav>
</template>

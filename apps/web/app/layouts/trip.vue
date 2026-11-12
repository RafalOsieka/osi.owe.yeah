<script setup lang="ts">
// The Trip's tabs (Expenses · Balances · Trip): the Trip header on top with the sync status
// (the list's mark while something isn't synced, or the server failed the last sync, as what
// was pulled may be stale: a cloud with an amber dot; its popover points at it, spans the
// content column and says whether the connection or the server holds sync up) and Invite,
// what sync has to tell (`TripNotices`) above the tab, the tab bar at the bottom and an
// optional `#action` floating just above it. Pulling a tab down syncs the Trip. Only for pages
// under `pages/trips/[id].vue`, which provides the open Trip.
const { trip, claim, unsynced, lastFailure, sync, askWhoYouAre, invite } = useOpenTrip();
const { t } = useI18n();
const back = useBack();
const { pulled, ready, refreshing } = usePullToRefresh(sync);
const syncOpen = ref(false);
const serverFailed = computed(() => lastFailure.value === 'server');
const needsSync = computed(() => unsynced.value > 0 || serverFailed.value);
const syncStatus = computed(() =>
  unsynced.value === 0 && serverFailed.value
    ? t('sync.serverFailed')
    : t('sync.unsynced', unsynced.value),
);

const tabs = computed(() => {
  const base = `/trips/${trip.value.id}`;
  return [
    { label: t('expense.list'), icon: 'i-lucide-receipt-text', to: base },
    { label: t('balances.title'), icon: 'i-lucide-scale', to: `${base}/balances` },
    { label: t('trip.tab'), icon: 'i-lucide-users-round', to: `${base}/settings` },
  ];
});
</script>

<template>
  <header
    class="sticky top-0 z-10 border-b border-default bg-canvas pt-[env(safe-area-inset-top)] backdrop-blur-xl backdrop-saturate-150"
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
        <h1 class="truncate text-base font-semibold text-highlighted">{{ trip.name }}</h1>
        <button
          type="button"
          class="block max-w-full cursor-pointer truncate text-[0.8125rem] text-muted hover:text-default"
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
      <UButton
        color="neutral"
        variant="ghost"
        :aria-label="syncStatus"
        :aria-expanded="syncOpen"
        aria-controls="sync-status"
        @click="syncOpen = !syncOpen"
      >
        <span class="relative">
          <UIcon
            :name="needsSync ? 'i-lucide-cloud' : 'i-lucide-cloud-check'"
            class="block size-5 text-muted"
          />
          <span
            v-if="needsSync"
            class="absolute -end-0.5 -top-0.5 size-2 rounded-full bg-warning"
          />
        </span>
      </UButton>
      <UButton
        icon="i-lucide-share-2"
        color="neutral"
        variant="ghost"
        :aria-label="$t('invite.action')"
        @click="invite"
      />
    </div>
    <!-- The sync status opens in the header itself and pushes the page down, so it never
         sits over the list. -->
    <div v-if="syncOpen" id="sync-status" class="flex gap-3 border-t border-default px-4 py-3">
      <span class="relative mt-0.5 shrink-0">
        <UIcon
          :name="needsSync ? 'i-lucide-cloud' : 'i-lucide-cloud-check'"
          class="block size-5"
          :class="needsSync ? 'text-muted' : 'text-success'"
        />
        <span v-if="needsSync" class="absolute -end-0.5 -top-0.5 size-2 rounded-full bg-warning" />
      </span>
      <div>
        <p class="font-semibold text-highlighted">{{ syncStatus }}</p>
        <p v-if="needsSync" class="mt-0.5 text-sm text-muted">
          {{ serverFailed ? $t('sync.serverFailedHelp') : $t('sync.unsyncedHelp') }}
        </p>
      </div>
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
  <!-- At the end, the last card stops 1rem above the floating action (4rem tabs + 1rem + 3rem). -->
  <main class="px-4 pt-4 pb-[calc(9rem+env(safe-area-inset-bottom))]">
    <TripNotices />
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
    class="fixed inset-x-0 bottom-0 z-10 mx-auto max-w-120 border-t border-default bg-default pb-[env(safe-area-inset-bottom)] backdrop-blur-xl backdrop-saturate-150"
  >
    <!-- Tabs replace each other in history, so back always leaves the Trip. -->
    <ul class="flex">
      <li v-for="tab in tabs" :key="tab.to" class="flex-1">
        <NuxtLink
          :to="tab.to"
          replace
          class="group flex h-16 flex-col items-center justify-center gap-1 text-[0.8125rem] font-medium text-muted aria-[current=page]:text-highlighted"
        >
          <span
            class="grid h-7 w-14 place-items-center rounded-full transition-colors group-aria-[current=page]:bg-primary/12 group-aria-[current=page]:text-primary"
          >
            <UIcon :name="tab.icon" class="size-5" />
          </span>
          {{ tab.label }}
        </NuxtLink>
      </li>
    </ul>
  </nav>
</template>

<script setup lang="ts">
// The Trip's tabs (Expenses · Balances · Trip): the Trip header on top, the tab bar at the
// bottom and an optional `#action` floating just above it. Only for pages under
// `pages/trips/[id].vue`, which provides the open Trip.
const { trip, claim, askWhoYouAre } = useOpenTrip();
const { t } = useI18n();
const back = useBack();

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
    </div>
  </header>
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

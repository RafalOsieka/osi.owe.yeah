<script setup lang="ts">
import type { BrowserSubscription } from '~/sync/db';

// "Notifications", opened from the Trip tab (#41): the toggle for this Trip on this device,
// in one card headed by the Trip's name and a status chip. While off, the explanation comes
// before the browser's prompt (back is the way out, so no "Not now"), or the steps to unblock
// while the browser blocks them; while on, it says so and turns them off. Notifications are about what involves the device's Claim, so without one
// it asks "Who are you?" first.
definePageMeta({ viewTransition: { toTypes: ['forward'], fromTypes: ['back'] } });

const { trip, claim, notifications, turnOnNotifications, turnOffNotifications, askWhoYouAre } =
  useOpenTrip();
const { t } = useI18n();
const back = useBack();

const parent = computed(() => `/trips/${trip.value.id}/settings`);
const { support } = usePushNotifications();

// The status chip under the Trip's name, as the Trip tab's row says it. Turned on but blocked
// by the browser since is not on: nothing arrives, so it offers the steps to unblock and
// "Check again", which takes the browser's subscription anew.
const on = computed(() => notifications.value.subscription !== null && support.value !== 'denied');
const state = computed(() => {
  if (!claim.value) return { label: t('notifications.pickFirst'), color: 'neutral' } as const;
  if (on.value) return { label: t('notifications.on'), color: 'success' } as const;
  return support.value === 'denied'
    ? ({ label: t('notifications.blockedShort'), color: 'warning' } as const)
    : ({ label: t('notifications.off'), color: 'neutral' } as const);
});

async function turnOn(subscription: BrowserSubscription): Promise<void> {
  await turnOnNotifications(subscription);
  await back(parent.value);
}

useHead({ title: () => t('notifications.title') });
</script>

<template>
  <NuxtLayout name="form" :title="$t('notifications.title')" :parent="parent">
    <div class="card p-4">
      <div class="mb-4 flex items-center gap-3 border-b border-default pb-4">
        <span
          class="grid size-11 shrink-0 place-items-center rounded-xl"
          :class="on ? 'bg-primary/12 text-primary' : 'bg-elevated text-muted'"
          aria-hidden="true"
        >
          <UIcon :name="on ? 'i-lucide-bell-ring' : 'i-lucide-bell'" class="size-5" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="font-semibold text-highlighted wrap-anywhere">{{ trip.name }}</p>
          <UBadge
            :label="state.label"
            :color="state.color"
            variant="subtle"
            size="lg"
            class="mt-1 rounded-full"
          />
        </div>
      </div>
      <div v-if="!claim" class="space-y-4">
        <p>{{ $t('notifications.pickFirstHelp') }}</p>
        <UButton block size="xl" :label="$t('claim.title')" @click="askWhoYouAre" />
      </div>
      <div v-else-if="on" class="space-y-4">
        <p>{{ $t('notifications.isOn', { name: trip.name }) }}</p>
        <UButton
          block
          size="xl"
          variant="outline"
          color="neutral"
          icon="i-lucide-bell-off"
          :label="$t('notifications.turnOff')"
          @click="turnOffNotifications"
        />
      </div>
      <NotificationsOffer v-else :trip-name="trip.name" @subscribed="turnOn" />
    </div>
  </NuxtLayout>
</template>

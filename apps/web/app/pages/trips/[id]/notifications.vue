<script setup lang="ts">
import type { BrowserSubscription } from '~/sync/db';

// "Notifications", opened from the Trip tab (#41): the toggle for this Trip on this device.
// While off, the explanation comes before the browser's prompt; while on, it says so and
// turns them off. Notifications are about what involves the device's Claim, so without one
// it asks "Who are you?" first.
definePageMeta({ viewTransition: { toTypes: ['forward'], fromTypes: ['back'] } });

const { trip, claim, notifications, turnOnNotifications, turnOffNotifications, askWhoYouAre } =
  useOpenTrip();
const { t } = useI18n();
const back = useBack();

const parent = computed(() => `/trips/${trip.value.id}/settings`);
const { support } = usePushNotifications();

// The bell on top, and the state under the Trip's name, as the Trip tab's row says it.
const on = computed(() => notifications.value.subscription !== null);
const state = computed(() => {
  if (!claim.value) return t('notifications.pickFirst');
  if (on.value) return t('notifications.on');
  return support.value === 'denied' ? t('notifications.blockedShort') : t('notifications.off');
});

async function turnOn(subscription: BrowserSubscription): Promise<void> {
  await turnOnNotifications(subscription);
  await back(parent.value);
}

useHead({ title: () => t('notifications.title') });
</script>

<template>
  <NuxtLayout name="form" :title="$t('notifications.title')" :parent="parent">
    <div class="flex flex-col items-center px-4 pt-4 pb-6 text-center">
      <span
        class="grid size-16 place-items-center rounded-2xl"
        :class="on ? 'bg-primary/12 text-primary' : 'bg-elevated text-muted'"
        aria-hidden="true"
      >
        <UIcon :name="on ? 'i-lucide-bell-ring' : 'i-lucide-bell'" class="size-7" />
      </span>
      <p class="mt-4 text-lg font-semibold tracking-tight text-highlighted wrap-anywhere">
        {{ trip.name }}
      </p>
      <p class="mt-0.5 text-sm text-muted">{{ state }}</p>
    </div>
    <div class="card p-4">
      <div v-if="!claim" class="space-y-4">
        <p>{{ $t('notifications.pickFirstHelp') }}</p>
        <UButton block size="lg" :label="$t('claim.title')" @click="askWhoYouAre" />
      </div>
      <div v-else-if="on" class="space-y-4">
        <p>{{ $t('notifications.isOn', { name: trip.name }) }}</p>
        <UButton
          block
          size="lg"
          variant="outline"
          color="neutral"
          icon="i-lucide-bell-off"
          :label="$t('notifications.turnOff')"
          @click="turnOffNotifications"
        />
      </div>
      <NotificationsOffer
        v-else
        :trip-name="trip.name"
        @subscribed="turnOn"
        @not-now="back(parent)"
      />
    </div>
  </NuxtLayout>
</template>

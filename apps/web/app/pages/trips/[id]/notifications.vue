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

async function turnOn(subscription: BrowserSubscription): Promise<void> {
  await turnOnNotifications(subscription);
  await back(parent.value);
}

useHead({ title: () => t('notifications.title') });
</script>

<template>
  <NuxtLayout name="form" :title="$t('notifications.title')" :parent="parent">
    <div v-if="!claim" class="space-y-4">
      <p class="text-sm">{{ $t('notifications.pickFirstHelp') }}</p>
      <UButton block size="lg" :label="$t('claim.title')" @click="askWhoYouAre" />
    </div>
    <div v-else-if="notifications.subscription" class="space-y-4">
      <p class="text-sm">{{ $t('notifications.isOn', { name: trip.name }) }}</p>
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
  </NuxtLayout>
</template>

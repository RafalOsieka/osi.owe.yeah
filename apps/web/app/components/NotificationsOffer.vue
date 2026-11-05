<script setup lang="ts">
import type { BrowserSubscription } from '~/sync/db';

// The explanation before the browser's permission prompt (#41): what notifications tell and
// that they are only for this Trip, only on this device. "Turn on" asks the browser and
// gives its subscription; "Not now" asks nothing. Where the browser can't ask, it says why
// instead: blocked, with steps to unblock; iOS outside the installed app; or no web push.
defineProps<{ tripName: string }>();
const emit = defineEmits<{ subscribed: [subscription: BrowserSubscription]; notNow: [] }>();

const { support, subscribe } = usePushNotifications();
const asking = ref(false);
const failed = ref(false);

async function turnOn(): Promise<void> {
  asking.value = true;
  failed.value = false;
  const result = await subscribe();
  asking.value = false;
  if (result.status === 'subscribed') emit('subscribed', result.subscription);
  else failed.value = result.status === 'failed';
}
</script>

<template>
  <div class="space-y-4">
    <div class="space-y-1.5">
      <p class="text-highlighted">{{ $t('notifications.what') }}</p>
      <p class="text-sm text-muted">{{ $t('notifications.where', { name: tripName }) }}</p>
    </div>

    <UAlert
      v-if="support === 'denied'"
      color="warning"
      variant="subtle"
      icon="i-lucide-bell-off"
      :title="$t('notifications.blockedHelp')"
    >
      <template #description>
        <ol class="mt-1 list-decimal space-y-1 ps-4">
          <li>{{ $t('notifications.blockedStep1') }}</li>
          <li>{{ $t('notifications.blockedStep2') }}</li>
          <li>{{ $t('notifications.blockedStep3') }}</li>
        </ol>
      </template>
    </UAlert>
    <UAlert
      v-else-if="support === 'homeScreen'"
      color="primary"
      variant="subtle"
      icon="i-lucide-smartphone"
      :title="$t('notifications.homeScreen')"
      :description="$t('notifications.homeScreenHelp')"
    />
    <UAlert
      v-else-if="support === 'unsupported'"
      color="neutral"
      variant="subtle"
      icon="i-lucide-bell-off"
      :title="$t('notifications.unsupported')"
    />
    <UAlert
      v-if="failed"
      color="error"
      variant="subtle"
      icon="i-lucide-cloud-off"
      :title="$t('notifications.failed')"
    />

    <div class="flex flex-col gap-2">
      <UButton
        v-if="support === 'available' || support === 'denied'"
        block
        size="lg"
        icon="i-lucide-bell"
        :label="$t('notifications.turnOn')"
        :loading="asking"
        @click="turnOn"
      />
      <UButton
        variant="ghost"
        color="neutral"
        block
        :label="$t('notifications.notNow')"
        @click="emit('notNow')"
      />
    </div>
  </div>
</template>

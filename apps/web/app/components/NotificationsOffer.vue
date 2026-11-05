<script setup lang="ts">
import type { BrowserSubscription } from '~/sync/db';

// The explanation before the browser's permission prompt (#41): what notifications tell and
// that they are only for this Trip, only on this device. "Turn on" asks the browser and
// gives its subscription; in a sheet (`dismissible`), "Not now" asks nothing. Where the browser
// can't ask, it says why instead: blocked, with neutral steps to unblock (where the setting
// is, labelled by platform: the browser, the installed app on Android, on iPhone or iPad) and
// "Check again", which asks once more; iOS outside the installed app; or no web push.
const { dismissible = false } = defineProps<{
  tripName: string;
  /** Offers "Not now", for the sheet that follows a Claim; a page has its back button. */
  dismissible?: boolean;
}>();
const emit = defineEmits<{ subscribed: [subscription: BrowserSubscription]; notNow: [] }>();

const { support, subscribe } = usePushNotifications();
// Where the notification setting is, by platform.
const places = ['inBrowser', 'inAndroidApp', 'inAppleApp'] as const;
const asking = ref(false);
const failed = ref(false);
// Checked again while still blocked: says so, as the button changes nothing visible.
const stillBlocked = ref(false);

async function turnOn(): Promise<void> {
  const blocked = support.value === 'denied';
  asking.value = true;
  failed.value = false;
  stillBlocked.value = false;
  const result = await subscribe();
  asking.value = false;
  if (result.status === 'subscribed') emit('subscribed', result.subscription);
  else failed.value = result.status === 'failed';
  stillBlocked.value = blocked && result.status === 'denied';
}
</script>

<template>
  <div class="space-y-4">
    <div class="space-y-1.5">
      <p class="text-highlighted">{{ $t('notifications.what') }}</p>
      <p class="text-sm text-muted">{{ $t('notifications.where', { name: tripName }) }}</p>
    </div>

    <div v-if="support === 'denied'" class="rounded-xl bg-elevated/60 p-3.5 text-sm">
      <p class="flex items-start gap-2 font-medium text-highlighted">
        <UIcon name="i-lucide-bell-off" class="mt-0.5 size-4 shrink-0 text-warning" />
        <!-- The page's status chip already says they're blocked; a sheet has none. -->
        {{ dismissible ? $t('notifications.blockedHelp') : $t('notifications.unblock') }}
      </p>
      <ol class="mt-2 list-decimal space-y-1.5 ps-6 text-default marker:text-muted">
        <li>
          {{ $t('notifications.blockedStep1') }}
          <ul class="mt-1.5 space-y-1.5">
            <li v-for="where in places" :key="where">
              <span class="font-medium text-highlighted">
                {{ $t(`notifications.${where}.label`) }}
              </span>
              {{ ' ' }}
              <i18n-t :keypath="`notifications.${where}.how`" tag="span" scope="global">
                <template #icon>
                  <UIcon
                    name="i-lucide-sliders-horizontal"
                    class="-mt-0.5 inline-block size-4 align-middle"
                    role="img"
                    :aria-label="$t('notifications.siteIcon')"
                  />
                </template>
              </i18n-t>
            </li>
          </ul>
        </li>
        <li>{{ $t('notifications.blockedStep2') }}</li>
        <li>{{ $t('notifications.blockedStep3') }}</li>
      </ol>
    </div>
    <UAlert
      v-else-if="support === 'homeScreen'"
      color="neutral"
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
    <p v-if="stillBlocked" role="status" class="text-sm text-muted">
      {{ $t('notifications.stillBlocked') }}
    </p>
    <UAlert
      v-if="failed"
      color="error"
      variant="subtle"
      icon="i-lucide-cloud-off"
      :title="$t('notifications.failed')"
    />

    <div class="flex flex-col gap-2">
      <UButton
        v-if="support === 'available'"
        block
        size="xl"
        :label="$t('notifications.turnOn')"
        :loading="asking"
        @click="turnOn"
      />
      <UButton
        v-else-if="support === 'denied'"
        block
        size="xl"
        color="neutral"
        variant="outline"
        icon="i-lucide-refresh-cw"
        :label="$t('notifications.checkAgain')"
        :loading="asking"
        @click="turnOn"
      />
      <UButton
        v-if="dismissible"
        variant="ghost"
        color="neutral"
        block
        :label="$t('notifications.notNow')"
        @click="emit('notNow')"
      />
    </div>
  </div>
</template>

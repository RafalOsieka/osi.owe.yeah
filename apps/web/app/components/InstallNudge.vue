<script setup lang="ts">
import type { AlertProps } from '@nuxt/ui';

// The install nudge on My Trips, until dismissed for good: installed, the app opens like one
// and its Trips are safe from the browser clearing them. "Install" opens the browser's own
// prompt where it has one; iOS Safari has none, so the nudge says how to add the app to the
// Home Screen instead.
const DISMISSED_KEY = 'owe-yeah:install-nudge-dismissed';

const { $pwa } = useNuxtApp();
const { t } = useI18n();
const dismissed = ref(localStorage.getItem(DISMISSED_KEY) === 'true');
const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);

const shown = computed(
  () => !dismissed.value && !!$pwa && !$pwa.isPWAInstalled && ($pwa.showInstallPrompt || ios),
);

const actions = computed<AlertProps['actions']>(() =>
  $pwa?.showInstallPrompt
    ? [{ label: t('install.action'), icon: 'i-lucide-download', onClick: () => $pwa.install() }]
    : [],
);

function dismiss(): void {
  dismissed.value = true;
  localStorage.setItem(DISMISSED_KEY, 'true');
}
</script>

<template>
  <UAlert
    v-if="shown"
    color="primary"
    variant="subtle"
    icon="i-lucide-smartphone"
    :title="$t('install.title')"
    :description="$pwa?.showInstallPrompt ? $t('install.why') : $t('install.ios')"
    :actions="actions"
    orientation="vertical"
    close
    class="mb-3"
    @update:open="dismiss"
  />
</template>

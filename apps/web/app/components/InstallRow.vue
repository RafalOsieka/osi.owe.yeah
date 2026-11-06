<script setup lang="ts">
// "Install Owe Yeah" in the Trip tab's device section: always there while the browser can install
// the app, so someone who came by a Trip link, or dismissed the nudge on My Trips, can still
// install it. It opens the browser's prompt, or on iOS says how to add the app to the Home Screen.
const { offer, install } = useInstallOffer();
</script>

<template>
  <button
    v-if="offer === 'prompt'"
    type="button"
    class="flex w-full min-h-14 cursor-pointer items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-elevated/60 active:bg-elevated"
    @click="install"
  >
    <span class="min-w-0 flex-1">
      <span class="block text-highlighted">{{ $t('install.title') }}</span>
      <span class="block text-sm text-muted">{{ $t('install.why') }}</span>
    </span>
    <UIcon name="i-lucide-download" class="size-5 shrink-0 text-dimmed" />
  </button>
  <div v-else-if="offer === 'homeScreen'" class="flex min-h-14 w-full items-center px-4 py-3">
    <span class="min-w-0 flex-1">
      <span class="block text-highlighted">{{ $t('install.title') }}</span>
      <InstallSteps class="text-sm text-muted" />
    </span>
  </div>
</template>

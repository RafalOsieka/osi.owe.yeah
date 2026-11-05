<script setup lang="ts">
// The install nudge on My Trips, until dismissed for good: installed, the app opens straight
// from the home screen. "Install" opens the browser's own prompt where it has one; iOS Safari
// has none, so the nudge says how to add the app to the Home Screen instead, with Safari's Share
// icon where the step names it. An outlined note on the canvas, not a white card, so it never
// reads as one of the Trips under it.
const DISMISSED_KEY = 'owe-yeah:install-nudge-dismissed';

const { $pwa } = useNuxtApp();
const dismissed = ref(localStorage.getItem(DISMISSED_KEY) === 'true');
const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);

const prompt = computed(() => !!$pwa?.showInstallPrompt);
const shown = computed(
  () => !dismissed.value && !!$pwa && !$pwa.isPWAInstalled && (prompt.value || ios),
);

function dismiss(): void {
  dismissed.value = true;
  localStorage.setItem(DISMISSED_KEY, 'true');
}
</script>

<template>
  <aside
    v-if="shown"
    aria-labelledby="install-nudge-title"
    class="flex items-start gap-3 rounded-xl py-3 ps-4 pe-2 ring-1 ring-accented ring-inset"
  >
    <UIcon
      name="i-lucide-square-plus"
      class="mt-2.5 size-5 shrink-0 text-primary"
      aria-hidden="true"
    />
    <div class="min-w-0 flex-1 pt-2">
      <p id="install-nudge-title" class="font-semibold text-highlighted">
        {{ $t('install.title') }}
      </p>
      <p v-if="prompt" class="mt-0.5 text-sm text-toned">{{ $t('install.why') }}</p>
      <i18n-t v-else keypath="install.ios" tag="p" scope="global" class="mt-0.5 text-sm text-toned">
        <template #share>
          <span class="whitespace-nowrap font-medium text-highlighted">
            <UIcon
              name="i-lucide-share"
              class="-mt-0.5 me-0.5 inline-block size-4 align-middle"
              aria-hidden="true"
            />
            {{ $t('install.share') }}
          </span>
        </template>
        <template #addToHomeScreen>
          <span class="font-medium text-highlighted">{{ $t('install.addToHomeScreen') }}</span>
        </template>
      </i18n-t>
      <UButton
        v-if="prompt"
        icon="i-lucide-download"
        :label="$t('install.action')"
        class="mt-3"
        @click="$pwa?.install()"
      />
    </div>
    <UButton
      icon="i-lucide-x"
      color="neutral"
      variant="ghost"
      class="text-dimmed"
      :aria-label="$t('form.close')"
      @click="dismiss"
    />
  </aside>
</template>

<script setup lang="ts">
// The install nudge on My Trips, until dismissed for good: installed, the app opens straight
// from the home screen. "Install" opens the browser's own prompt where it has one; iOS Safari
// has none, so the nudge says how to add the app to the Home Screen instead. Dismissing it
// leaves the Install row on the Trip tab (`InstallRow`). An outlined note on the canvas, not a
// white card, so it never reads as one of the Trips under it. The ✕ sits in the corner, so the
// text below the title runs the full width.
const DISMISSED_KEY = 'owe-yeah:install-nudge-dismissed';

const { offer, install } = useInstallOffer();
const dismissed = ref(localStorage.getItem(DISMISSED_KEY) === 'true');

function dismiss(): void {
  dismissed.value = true;
  localStorage.setItem(DISMISSED_KEY, 'true');
}
</script>

<template>
  <aside
    v-if="offer && !dismissed"
    aria-labelledby="install-nudge-title"
    class="relative flex items-start gap-3 rounded-xl py-3 ps-4 pe-4 ring-1 ring-accented ring-inset"
  >
    <UIcon
      name="i-lucide-square-plus"
      class="mt-2.5 size-5 shrink-0 text-primary"
      aria-hidden="true"
    />
    <div class="min-w-0 flex-1 pt-2">
      <p id="install-nudge-title" class="pe-10 font-semibold text-highlighted">
        {{ $t('install.title') }}
      </p>
      <template v-if="offer === 'prompt'">
        <p class="mt-0.5 text-sm text-toned">{{ $t('install.why') }}</p>
        <UButton
          icon="i-lucide-download"
          :label="$t('install.action')"
          class="mt-3"
          @click="install"
        />
      </template>
      <InstallSteps v-else class="mt-0.5 text-sm text-toned" />
    </div>
    <UButton
      icon="i-lucide-x"
      color="neutral"
      variant="ghost"
      class="absolute end-2 top-2 text-dimmed"
      :aria-label="$t('form.close')"
      @click="dismiss"
    />
  </aside>
</template>

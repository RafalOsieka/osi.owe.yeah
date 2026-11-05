<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router';

// Full-screen forms and detail pages: back (or close), a one-line title and the page's
// `#actions` (e.g. Edit) on top, the page's `#action` fixed at the bottom, no tabs. Back
// returns to the previous screen, or to `parent` when the page was opened from a link.
// Pages using it set the `forward` and `back` view-transition types, so they slide in and
// out.
const {
  title,
  parent,
  close = false,
  titleHidden = false,
} = defineProps<{
  title: string;
  parent: RouteLocationRaw;
  /** A close (×) instead of a back arrow, for forms that create something. */
  close?: boolean;
  /** Keeps the title for screen readers only, for a page that shows it large itself. */
  titleHidden?: boolean;
}>();

const back = useBack();
</script>

<template>
  <header
    class="sticky top-0 z-10 border-b border-default bg-canvas/80 pt-[env(safe-area-inset-top)] backdrop-blur-xl backdrop-saturate-150"
  >
    <div class="flex h-14 items-center gap-1 px-2">
      <UButton
        :icon="close ? 'i-lucide-x' : 'i-lucide-chevron-left'"
        color="neutral"
        variant="ghost"
        :aria-label="close ? $t('form.close') : $t('form.back')"
        @click="back(parent)"
      />
      <h1
        class="min-w-0 flex-1 truncate text-base font-semibold text-highlighted"
        :class="{ 'sr-only': titleHidden }"
      >
        {{ title }}
      </h1>
      <span v-if="titleHidden" class="flex-1" />
      <slot name="actions" />
    </div>
  </header>
  <main class="px-4 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))]">
    <slot />
  </main>
  <div
    v-if="$slots.action"
    class="fixed inset-x-0 bottom-0 mx-auto max-w-120 bg-linear-to-t from-canvas from-70% to-canvas/0 px-4 pt-6 pb-[calc(1rem+env(safe-area-inset-bottom))]"
  >
    <slot name="action" />
  </div>
</template>

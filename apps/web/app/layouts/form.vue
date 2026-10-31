<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router';

// Full-screen forms and detail pages: back (or close) and a one-line title on top, the
// page's `#action` fixed at the bottom, no tabs. Back returns to the previous screen, or
// to `parent` when the page was opened from a link. Pages using it set the `forward` and
// `back` view-transition types, so they slide in and out.
const {
  title,
  parent,
  close = false,
} = defineProps<{
  title: string;
  parent: RouteLocationRaw;
  /** A close (×) instead of a back arrow, for forms that create something. */
  close?: boolean;
}>();

const back = useBack();
</script>

<template>
  <header
    class="sticky top-0 z-10 border-b border-default bg-default pt-[env(safe-area-inset-top)]"
  >
    <div class="flex h-14 items-center gap-1 px-2">
      <UButton
        :icon="close ? 'i-lucide-x' : 'i-lucide-chevron-left'"
        color="neutral"
        variant="ghost"
        :aria-label="close ? $t('form.close') : $t('form.back')"
        @click="back(parent)"
      />
      <h1 class="min-w-0 flex-1 truncate text-base font-semibold">{{ title }}</h1>
    </div>
  </header>
  <main class="px-4 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))]">
    <slot />
  </main>
  <div
    v-if="$slots.action"
    class="fixed inset-x-0 bottom-0 mx-auto max-w-120 border-t border-default bg-default px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
  >
    <slot name="action" />
  </div>
</template>

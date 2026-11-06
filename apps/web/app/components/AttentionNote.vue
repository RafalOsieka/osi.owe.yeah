<script setup lang="ts">
// The one look for "needs attention" (amber): a Conflict, units not assigned yet, a change that
// would be lost, a pending Line item. A soft amber fill (opaque, so it reads the same on a
// card and on the canvas) with a hairline amber edge, the icon on
// the first line, the message in the text colour, and an optional `#action` (e.g. a link to
// the Line item, or Choose a change) under it.
const { icon = 'i-lucide-circle-alert' } = defineProps<{ icon?: string }>();
</script>

<template>
  <div
    role="note"
    class="flex gap-2.5 rounded-lg bg-[color-mix(in_oklab,var(--ui-warning)_10%,var(--ui-bg))] px-3.5 py-3 text-sm text-highlighted ring-1 ring-warning/25 ring-inset"
  >
    <UIcon :name="icon" class="mt-0.5 size-4 shrink-0 text-warning" />
    <div class="min-w-0 flex-1">
      <slot />
      <div v-if="$slots.action" class="mt-2.5">
        <slot name="action" />
      </div>
    </div>
  </div>
</template>

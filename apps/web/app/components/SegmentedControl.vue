<script setup lang="ts" generic="T extends string">
// A small set of mutually exclusive options as one pill: the chosen one raised on a quiet
// track (Split mode, a discount's kind, a Manual rate's kind). Each option is a toggle button
// (`aria-pressed`), named by its label, in a group named by `label`.
const { options, label } = defineProps<{
  options: readonly { value: T; label: string }[];
  /** Names the group for screen readers. */
  label: string;
}>();
const model = defineModel<T>({ required: true });
</script>

<template>
  <div role="group" :aria-label="label" class="inline-flex rounded-full bg-elevated p-0.5">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      :aria-pressed="model === option.value"
      class="flex-1 cursor-pointer rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap text-muted transition-colors hover:text-default focus-visible:outline-2 focus-visible:outline-primary aria-pressed:bg-default aria-pressed:text-highlighted aria-pressed:shadow-sm dark:aria-pressed:bg-accented"
      @click="model = option.value"
    >
      {{ option.label }}
    </button>
  </div>
</template>

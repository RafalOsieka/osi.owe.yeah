<script setup lang="ts">
// Secondary guidance behind a small "i" beside a field's label, opened by a tap, so the form
// keeps only what is needed to fill it in. `label` names the field it explains; `text` says it.
// It takes no more height than the label, so labelled fields side by side stay aligned.
const { label, text } = defineProps<{ label: string; text: string }>();
</script>

<template>
  <UPopover :content="{ side: 'top', align: 'end' }">
    <!-- No taller than the label's line, so a field with a tip lines up with its neighbours;
         the invisible overlay keeps a 44 px tap area. -->
    <UButton
      icon="i-lucide-info"
      color="neutral"
      variant="ghost"
      size="xs"
      square
      :aria-label="$t('form.moreInfo', { label })"
      class="relative -my-1 -me-1 text-muted before:absolute before:-inset-2.5 before:content-['']"
    />
    <template #content>
      <p class="max-w-64 p-3 text-sm text-default">{{ text }}</p>
    </template>
  </UPopover>
</template>

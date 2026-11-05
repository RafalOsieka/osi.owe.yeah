<script setup lang="ts">
// Secondary guidance behind a small "i" beside a field's label, opened by a tap, so the form
// keeps only what is needed to fill it in. `label` names the field it explains; `text` says it.
const { label, text } = defineProps<{ label: string; text: string }>();
</script>

<template>
  <UPopover :content="{ side: 'top', align: 'end' }">
    <UButton
      icon="i-lucide-info"
      color="neutral"
      variant="ghost"
      square
      :aria-label="$t('form.moreInfo', { label })"
      class="-my-3 -me-3 text-muted"
    />
    <template #content>
      <p class="max-w-64 p-3 text-sm text-default">{{ text }}</p>
    </template>
  </UPopover>
</template>

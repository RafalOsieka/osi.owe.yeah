<script setup lang="ts">
// The "you" chip after the claimed Participant's name, wherever that name appears: lists,
// detail pages, sheets and the forms' pickers. One look everywhere, legible at 13 px.
</script>

<template>
  <UBadge
    :label="$t('participants.you')"
    variant="subtle"
    size="md"
    class="ms-1.5 shrink-0 align-middle text-[0.8125rem]"
  />
</template>

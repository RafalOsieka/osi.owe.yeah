<script setup lang="ts">
import type { ProtoDraft } from '~/prototype/photos-drafts';

// PROTOTYPE (#282): one Draft as a row: its Photo, its state, who scanned it and when.
const { draft } = defineProps<{ draft: ProtoDraft }>();
const { trip } = useOpenTrip();
const status = useDraftStatus();
</script>

<template>
  <NuxtLink
    :to="`/trips/${trip.id}/drafts/${draft.id}`"
    class="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-elevated/60"
  >
    <PrototypePhotoThumb :photo="draft.photo" class="h-14 w-11 shrink-0" />
    <span class="min-w-0 flex-1 leading-snug">
      <span class="flex items-center gap-1.5 font-medium" :class="status(draft).tone">
        <UIcon
          :name="status(draft).icon"
          class="size-4 shrink-0"
          :class="status(draft).iconClass"
        />
        {{ status(draft).label }}
      </span>
      <span v-if="draft.state === 'ready'" class="block text-sm text-highlighted">
        Sklep spożywczy · 6 Line items
      </span>
      <span v-if="draft.reason" class="block text-sm text-muted">{{ draft.reason }}</span>
      <span class="block text-sm text-muted">{{ status(draft).by }}</span>
    </span>
    <UIcon name="i-lucide-chevron-right" class="size-5 shrink-0 text-dimmed" />
  </NuxtLink>
</template>

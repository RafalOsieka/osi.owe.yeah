<script setup lang="ts">
import type { ProtoPhoto } from '~/prototype/photos-drafts';

// PROTOTYPE (#282): one Photo as a thumbnail, with its upload state: the list's not-synced
// cloud while it waits, an amber ring and mark once refused for good.
const { photo } = defineProps<{ photo: ProtoPhoto }>();
</script>

<template>
  <span
    class="relative block overflow-hidden rounded-lg bg-elevated ring-1 ring-default"
    :class="{ 'ring-2 ring-warning': photo.state === 'refused' }"
  >
    <img :src="photo.url" alt="" class="size-full object-cover object-top" />
    <span
      v-if="photo.state === 'queued'"
      class="absolute end-1 bottom-1 grid size-6 place-items-center rounded-full bg-default/90 shadow-xs"
    >
      <span class="relative">
        <UIcon name="i-lucide-cloud" class="block size-3.5 text-muted" />
        <span class="absolute -end-0.5 -top-0.5 size-1.5 rounded-full bg-warning" />
      </span>
    </span>
    <span
      v-if="photo.state === 'refused'"
      class="absolute end-1 bottom-1 grid size-6 place-items-center rounded-full bg-warning text-inverted shadow-xs"
    >
      <UIcon name="i-lucide-circle-alert" class="size-3.5" />
    </span>
  </span>
</template>

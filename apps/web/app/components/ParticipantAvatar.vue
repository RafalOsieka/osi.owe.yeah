<script setup lang="ts">
import type { AvatarProps } from '@nuxt/ui';
import type { Participant } from '@osi/owe-yeah-domain';

// A Participant's avatar: their initial on a color picked by their id, so it is the same
// on every device. Decorative: the name is always shown next to it.
const { participant, size = 'sm' } = defineProps<{
  participant: Participant;
  size?: AvatarProps['size'];
}>();

const initial = computed(() => Array.from(participant.name)[0]?.toLocaleUpperCase() ?? '');
</script>

<template>
  <UAvatar
    :text="initial"
    :size="size"
    :class="avatarColor(participant.id)"
    :ui="{ fallback: 'font-semibold text-white' }"
    aria-hidden="true"
  />
</template>

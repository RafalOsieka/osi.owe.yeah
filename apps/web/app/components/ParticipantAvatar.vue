<script setup lang="ts">
import type { AvatarProps } from '@nuxt/ui';
import type { Participant } from '@osi/owe-yeah-domain';
import type { AvatarColor } from '~/utils/avatar';

// A Participant's avatar: their initial on a tint picked by their place in the Trip
// (`useAvatarColor`), so it is the same on every device. Where no Trip is open (My Trips),
// `color` gives it (`participantAvatarColors`). Decorative: the name is always shown next to it.
const {
  participant,
  size = 'sm',
  color = undefined,
} = defineProps<{
  participant: Participant;
  size?: AvatarProps['size'];
  /** Their color in their Trip, where no Trip is open. */
  color?: AvatarColor;
}>();

const colorOf = useAvatarColor();
const tint = computed(() => color ?? colorOf(participant.id));

const initial = computed(() => Array.from(participant.name)[0]?.toLocaleUpperCase() ?? '');
</script>

<template>
  <UAvatar
    :text="initial"
    :size="size"
    :class="tint"
    :ui="{ fallback: 'font-semibold text-inherit' }"
    aria-hidden="true"
  />
</template>

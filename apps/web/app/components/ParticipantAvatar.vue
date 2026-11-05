<script setup lang="ts">
import type { AvatarProps } from '@nuxt/ui';
import type { Participant } from '@osi/owe-yeah-domain';

// A Participant's avatar: their initial on a tint picked by their place in the Trip
// (`useAvatarColor`), so it is the same on every device. Outside a Trip, `index` gives
// their place. Decorative: the name is always shown next to it.
const {
  participant,
  size = 'sm',
  index = null,
} = defineProps<{
  participant: Participant;
  size?: AvatarProps['size'];
  /** Their place in the Trip's order, where no Trip is open (My Trips). */
  index?: number | null;
}>();

const colorOf = useAvatarColor();
const color = computed(() => (index === null ? colorOf(participant.id) : avatarColorAt(index)));

const initial = computed(() => Array.from(participant.name)[0]?.toLocaleUpperCase() ?? '');
</script>

<template>
  <UAvatar
    :text="initial"
    :size="size"
    :class="color"
    :ui="{ fallback: 'font-semibold text-inherit' }"
    aria-hidden="true"
  />
</template>

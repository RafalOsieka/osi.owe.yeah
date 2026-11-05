<script setup lang="ts">
import type { Participant } from '@osi/owe-yeah-domain';

// A Participant as a chip with their avatar, tinted when chosen, filling its cell of the
// pickers' grid. Its mark says how the field picks: a round radio for one choice ("Paid by"),
// a square checkbox for several ("For whom"), each empty until chosen. A real input covers the
// chip, so it is announced and works from the keyboard like any other. `disabled` greys out
// someone who can't be picked here, e.g. who paid a Repayment as its recipient. Long names are
// cut at the chip's maximum width.
const {
  participant,
  type,
  name,
  disabled = false,
} = defineProps<{
  participant: Participant;
  type: 'radio' | 'checkbox';
  /** Groups the inputs of one field. */
  name: string;
  disabled?: boolean;
}>();
const checked = defineModel<boolean>('checked', { required: true });

function change(event: Event): void {
  // SAFETY: the listener sits on the <input> itself.
  checked.value = (event.currentTarget as HTMLInputElement).checked;
}
</script>

<template>
  <label
    class="group relative flex h-11 min-w-0 items-center gap-2 rounded-full bg-default ps-1.5 pe-3 text-sm font-medium text-default ring ring-accented transition-colors has-checked:bg-primary/10 has-checked:text-highlighted has-checked:ring-primary/50 has-disabled:opacity-45 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary dark:ring-neutral-700 dark:has-checked:bg-primary/18 dark:has-checked:ring-primary/70"
  >
    <input
      :type="type"
      :name="name"
      :checked="checked"
      :disabled="disabled"
      class="absolute inset-0 cursor-pointer appearance-none rounded-full opacity-0 disabled:cursor-not-allowed"
      @change="change"
    />
    <ParticipantAvatar :participant="participant" size="xs" class="ring-2 ring-(--ui-bg)" />
    <span class="min-w-0 flex-1 truncate">{{ participant.name }}</span>
    <span
      v-if="type === 'radio'"
      class="grid size-5 shrink-0 place-items-center rounded-full ring-2 ring-neutral-300 ring-inset group-has-checked:ring-primary dark:ring-neutral-600"
      aria-hidden="true"
    >
      <span
        class="size-2.5 scale-0 rounded-full bg-primary transition-transform group-has-checked:scale-100"
      />
    </span>
    <span
      v-else
      class="grid size-5 shrink-0 place-items-center rounded-md ring-2 ring-neutral-300 ring-inset transition-colors group-has-checked:bg-primary group-has-checked:ring-primary dark:ring-neutral-600"
      aria-hidden="true"
    >
      <UIcon
        name="i-lucide-check"
        class="size-3.5 text-inverted opacity-0 group-has-checked:opacity-100"
      />
    </span>
  </label>
</template>

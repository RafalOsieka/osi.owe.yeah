<script setup lang="ts">
import { participantNameSchema } from '@osi/owe-yeah-domain';
import type { FormError } from '@nuxt/ui';

// One name field and a button, used for "Add me", for adding a Participant, and, given their
// `name`, for correcting a Participant's name. The button is the solid primary once a new name
// is typed, and plainly unavailable before; it has the field's corners, so the two read as one
// control. Emits the trimmed name, never an unchanged one, and the parent does the saving.
// A form for a new name then clears itself; one correcting a name keeps what was typed as its
// sheet closes.
const { name, icon = 'i-lucide-user-plus' } = defineProps<{
  label: string;
  submitLabel: string;
  icon?: string;
  name?: string;
}>();
const emit = defineEmits<{ submit: [name: string] }>();

const { t } = useI18n();
const state = reactive({ name: name ?? '' });
const typed = computed(() => {
  const trimmed = state.name.trim();
  return trimmed !== '' && trimmed !== name;
});

function validate(form: Partial<typeof state>): FormError[] {
  return participantNameSchema.safeParse(form.name).success
    ? []
    : [{ name: 'name', message: t('participants.nameInvalid') }];
}

function submit(): void {
  // Enter submits even while the button is unavailable.
  if (!typed.value) return;
  emit('submit', participantNameSchema.parse(state.name));
  if (name === undefined) state.name = '';
}
</script>

<template>
  <UForm :state="state" :validate="validate" class="flex items-start gap-2" @submit="submit">
    <UFormField name="name" :label="label" class="grow">
      <UInput
        v-model="state.name"
        :placeholder="$t('participants.namePlaceholder')"
        class="w-full"
      />
    </UFormField>
    <UButton
      type="submit"
      :color="typed ? 'primary' : 'neutral'"
      :variant="typed ? 'solid' : 'soft'"
      :disabled="!typed"
      :icon="icon"
      :label="submitLabel"
      class="mt-6 shrink-0 rounded-lg disabled:text-dimmed"
    />
  </UForm>
</template>

<script setup lang="ts">
import { absolute, type Rational } from '@osi/owe-yeah-domain';
import type { ExpenseDraft } from '~/utils/expense-draft';

// The discard confirm of a changed form (`useDiscardConfirm`): a bottom sheet whose title says
// what would be lost, and under it what was typed so far ("Konzum Pula · €16.05 · 3 Line
// items"), so nobody throws away a long Receipt by reflex. Keep editing, the safe action, is
// focused when it opens and sits at the bottom, where the thumb lands first; Discard, above it,
// is the only red. Keep editing closes the sheet and leaves the form as it was, focus back
// where it was.
const { title, draft, total } = defineProps<{
  title: string;
  draft: ExpenseDraft;
  /** What the draft comes to so far (`readDraft`); `null` while it can't be read. */
  total: Rational | null;
}>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ discard: [] }>();

const { t, locale } = useI18n();

// The title, the amount (as typed, without Income's minus) and how many Line items, as far as
// there are any.
const summary = computed(() => {
  const lineItems = draft.kind === 'split' ? (draft.lineItems?.length ?? 0) : 0;
  return [
    draft.title.trim(),
    total && total.numerator !== 0n
      ? formatMoney(absolute(total), draft.currency, locale.value)
      : '',
    lineItems > 0 ? t('discard.lineItems', lineItems) : '',
  ]
    .filter((part) => part !== '')
    .join(' · ');
});

function focusKeep(event: Event): void {
  event.preventDefault();
  document.getElementById('discard-keep')?.focus();
}
</script>

<template>
  <UDrawer
    v-model:open="open"
    :title="title"
    :description="summary || undefined"
    :content="{ onOpenAutoFocus: focusKeep }"
    :ui="{ description: 'truncate tabular-nums', footer: 'pb-2' }"
  >
    <template #footer>
      <UButton
        color="error"
        block
        size="xl"
        icon="i-lucide-trash-2"
        :label="$t('discard.discard')"
        @click="emit('discard')"
      />
      <UButton
        id="discard-keep"
        color="neutral"
        variant="outline"
        block
        size="xl"
        icon="i-lucide-pencil"
        :label="$t('discard.keep')"
        @click="open = false"
      />
    </template>
  </UDrawer>
</template>

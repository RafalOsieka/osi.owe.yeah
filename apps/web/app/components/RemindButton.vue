<script setup lang="ts">
import type { RemindBy } from '~/composables/useReminders';

// Remind on a creditor's own Suggested Repayment (#42), a quiet icon button beside Record. Its
// icon says beforehand how it reminds: a bell sends a push notification; share or copy passes
// on a pre-filled message, as the debtor can't be notified or this device is offline (a line
// above the list says so); a tick, disabled, once the pair was reminded today. Its label,
// read out and shown on hover, says the same in words ("Remind Kasia with a message you
// share").
const {
  by,
  debtor,
  sending = false,
} = defineProps<{
  by: RemindBy;
  debtor: string;
  sending?: boolean;
}>();
defineEmits<{ remind: [] }>();

const { t } = useI18n();

const button = computed(() => {
  switch (by) {
    case 'remindedToday':
      return { icon: 'i-lucide-check', label: t('reminder.remindedToday') };
    case 'share':
      return { icon: 'i-lucide-share-2', label: t('reminder.shareLabel', { name: debtor }) };
    case 'copy':
      return { icon: 'i-lucide-copy', label: t('reminder.copyLabel', { name: debtor }) };
    case 'push':
    case 'checking':
      return { icon: 'i-lucide-bell-ring', label: t('reminder.pushLabel', { name: debtor }) };
  }
});
</script>

<template>
  <UButton
    color="neutral"
    variant="ghost"
    :icon="button.icon"
    :aria-label="button.label"
    :title="button.label"
    :loading="sending || by === 'checking'"
    :disabled="by === 'remindedToday'"
    class="shrink-0"
    @click="$emit('remind')"
  />
</template>

<script setup lang="ts">
import type { RemindBy } from '~/composables/useReminders';

// Remind on a creditor's own Suggested Repayment (#42). Its icon says beforehand how it
// reminds: a bell sends a push notification; share or copy passes on a pre-filled message,
// as the debtor can't be notified or this device is offline (the row says so too).
// "Reminded today" once the pair was reminded.
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
  const remind = t('reminder.remind');
  switch (by) {
    case 'remindedToday':
      return { icon: 'i-lucide-check', label: t('reminder.remindedToday'), aria: undefined };
    case 'share':
      return {
        icon: 'i-lucide-share-2',
        label: remind,
        aria: t('reminder.shareLabel', { name: debtor }),
      };
    case 'copy':
      return {
        icon: 'i-lucide-copy',
        label: remind,
        aria: t('reminder.copyLabel', { name: debtor }),
      };
    case 'push':
    case 'checking':
      return {
        icon: 'i-lucide-bell-ring',
        label: remind,
        aria: t('reminder.pushLabel', { name: debtor }),
      };
  }
});
</script>

<template>
  <UButton
    variant="ghost"
    :icon="button.icon"
    :label="button.label"
    :aria-label="button.aria"
    :loading="sending || by === 'checking'"
    :disabled="by === 'remindedToday'"
    class="shrink-0"
    @click="$emit('remind')"
  />
</template>

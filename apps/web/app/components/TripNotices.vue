<script setup lang="ts">
import type { Notice } from '~/sync/db';

// What sync has to tell about this device's changes, on top of every Trip tab until
// dismissed: a removed Participant one of its Expenses brought back, or a removal or a Trip
// currency the server refused. A removed Claim is told in "Who are you?" instead.
const { notices, dismissNotice } = useOpenTrip();
const { t } = useI18n();

const shown = computed(() =>
  notices.value.flatMap((notice) => {
    const title = text(notice);
    return title ? [{ id: notice.id, title }] : [];
  }),
);

function text(notice: Notice): string | null {
  switch (notice.kind) {
    case 'participantRestored':
      return t('notices.participantRestored', {
        name: notice.participant.name,
        title: notice.expenseTitle,
      });
    case 'removalRefused':
      return t('notices.removalRefused', { name: notice.participant.name });
    case 'currencyRefused':
      return t('notices.currencyRefused', { currency: notice.currency });
    case 'claimRemoved':
      return null;
  }
}
</script>

<template>
  <ul v-if="shown.length > 0" class="mb-3 space-y-2">
    <li v-for="notice in shown" :key="notice.id">
      <UAlert
        color="info"
        variant="subtle"
        icon="i-lucide-info"
        :title="notice.title"
        close
        @update:open="dismissNotice(notice.id)"
      />
    </li>
  </ul>
</template>

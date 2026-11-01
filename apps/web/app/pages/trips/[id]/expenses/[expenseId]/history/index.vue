<script setup lang="ts">
import type { Rational } from '@osi/owe-yeah-domain';

// An Expense's History, opened from its detail page: its Revisions, newest first, each with
// who made it, when, what it did and the total before → after. Read-only; each Revision opens
// as the whole old Expense, where it can be restored. Needs a connection.
definePageMeta({ viewTransition: { toTypes: ['forward'], fromTypes: ['back'] } });

const { trip } = useOpenTrip();
const { t, locale } = useI18n();
const route = useRoute();

const expenseId = String(route.params.expenseId);
const detail = computed(() => `/trips/${trip.value.id}/expenses/${expenseId}`);

const { data, status } = useRevisions(expenseId);

const money = (amount: Rational) => formatMoney(amount, trip.value.currency, locale.value);

const rows = computed(() => {
  const now = new Date();
  return revisionEntries(data.value ?? []).map(({ revision, kind, before, after }) => {
    const { by, at } = revision.edited;
    return {
      version: revision.version,
      kind: t(`history.kind.${kind}`),
      author: trip.value.participants.find(({ id }) => id === by),
      when: formatTimeAgo(at, now, locale.value),
      total: before === null ? money(after) : `${money(before)} → ${money(after)}`,
    };
  });
});

useHead({ title: () => t('history.title') });
</script>

<template>
  <NuxtLayout name="form" :title="$t('history.title')" :parent="detail">
    <ul v-if="rows.length > 0">
      <li v-for="row in rows" :key="row.version" class="border-b border-default last:border-b-0">
        <NuxtLink :to="`${detail}/history/${row.version}`" class="flex items-center gap-2.5 py-2.5">
          <ParticipantAvatar v-if="row.author" :participant="row.author" />
          <UIcon v-else name="i-lucide-user-round" class="size-6 shrink-0 text-dimmed" />
          <span class="min-w-0 flex-1 leading-snug">
            <span class="block truncate font-semibold">{{ row.kind }}</span>
            <span class="block truncate text-xs text-muted">
              {{
                $t('history.byline', {
                  name: row.author?.name ?? $t('history.someone'),
                  when: row.when,
                })
              }}
            </span>
          </span>
          <span class="shrink-0 text-sm tabular-nums">{{ row.total }}</span>
        </NuxtLink>
      </li>
    </ul>
    <UEmpty
      v-else-if="status === 'error'"
      icon="i-lucide-cloud-off"
      variant="naked"
      :title="$t('history.offline')"
    />
    <UEmpty
      v-else-if="status === 'success'"
      icon="i-lucide-history"
      variant="naked"
      :title="$t('history.empty')"
    />
  </NuxtLayout>
</template>

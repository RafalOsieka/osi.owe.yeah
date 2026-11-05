<script setup lang="ts">
import { compare, type Rational } from '@osi/owe-yeah-domain';
import { findExpense } from '~/sync/local-trip';

// An Expense's History, opened from its detail page, under the Expense's title: its
// Revisions, newest first, each with who made it ("You" for the claimed Participant), when,
// what it did, for an edit what it changed, and the total after it, with what it was
// before when the change moved it; the version the
// Expense is at is marked Current. Read-only; each Revision opens (chevron) as the whole old
// Expense, where it can be restored. Needs a connection.
definePageMeta({ viewTransition: { toTypes: ['forward'], fromTypes: ['back'] } });

const { trip, claim, everyone } = useOpenTrip();
const { t, locale } = useI18n();
const route = useRoute();

const expenseId = String(route.params.expenseId);
const detail = computed(() => `/trips/${trip.value.id}/expenses/${expenseId}`);
const expense = computed(() => findExpense(trip.value, expenseId));

const { data, status } = useRevisions(expenseId);

// The Revision the Expense is at, unless this device has changed it since.
const currentVersion = computed(() => {
  const shown = expense.value;
  return shown && !shown.unsynced && 'version' in shown.base ? shown.base.version : null;
});

const rows = computed(() => {
  const now = new Date();
  const list = new Intl.ListFormat(locale.value);
  return revisionEntries(data.value ?? []).map(({ revision, kind, before, after, changed }) => {
    const { by, at } = revision.edited;
    const { currency } = revision.expense;
    const money = (amount: Rational) => formatMoney(amount, currency, locale.value);
    const name =
      by === claim.value?.id
        ? t('history.you')
        : (everyone.value.find(({ id }) => id === by)?.name ?? t('history.someone'));
    return {
      version: revision.version,
      kind: t(`history.kind.${kind}`),
      current: revision.version === currentVersion.value,
      author: everyone.value.find(({ id }) => id === by),
      byline: t('history.byline', {
        name,
        when: formatTimeAgo(at, now, locale.value, t('history.justNow')),
      }),
      changed:
        changed.length > 0
          ? t('history.changed', {
              fields: list.format(changed.map((field) => t(`history.field.${field}`))),
            })
          : null,
      total: money(after),
      // The total before an edit that moved it.
      was:
        before !== null && compare(before, after) !== 0
          ? t('history.was', { amount: money(before) })
          : null,
    };
  });
});

useHead({ title: () => t('history.title') });
</script>

<template>
  <NuxtLayout name="form" :title="$t('history.title')" :parent="detail">
    <p v-if="expense" class="mb-3 px-1 text-toned wrap-anywhere">{{ expense.title }}</p>
    <ul v-if="rows.length > 0" class="card divide-y divide-default overflow-hidden">
      <li v-for="row in rows" :key="row.version">
        <NuxtLink
          :to="`${detail}/history/${row.version}`"
          class="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-elevated/60"
        >
          <ParticipantAvatar v-if="row.author" :participant="row.author" size="md" />
          <UIcon v-else name="i-lucide-user-round" class="size-8 shrink-0 text-dimmed" />
          <span class="min-w-0 flex-1 leading-snug">
            <span class="flex items-center gap-2">
              <span class="truncate font-medium text-highlighted">{{ row.kind }}</span>
              <UBadge
                v-if="row.current"
                :label="$t('history.current')"
                variant="subtle"
                size="md"
                class="shrink-0 text-[0.8125rem]"
              />
            </span>
            <span class="block truncate text-sm text-muted">{{ row.byline }}</span>
            <span v-if="row.changed" class="block text-sm text-muted">{{ row.changed }}</span>
          </span>
          <span class="shrink-0 self-start text-end leading-snug tabular-nums">
            <span class="block font-medium text-highlighted">{{ row.total }}</span>
            <span v-if="row.was" class="block text-sm text-muted">{{ row.was }}</span>
          </span>
          <UIcon
            name="i-lucide-chevron-right"
            class="-me-1 size-4 shrink-0 text-dimmed"
            aria-hidden="true"
          />
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

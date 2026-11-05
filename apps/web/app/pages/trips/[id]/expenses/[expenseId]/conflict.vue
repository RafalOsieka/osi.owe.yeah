<script setup lang="ts">
import { findExpense } from '~/sync/local-trip';

// The Conflict screen, opened from the notice on an Expense's detail page: this device's
// version of the Expense and the one the server has, each a card named for whose it is ("Your
// version", "Tomek's version", when he changed it) with what differs highlighted, marked
// when it deletes the Expense, and ending in its own equal choice, after what that choice
// does to the other version: quiet where Tomek's stays in History, a restrained amber warning
// where yours is lost for good. Keep yours sends this device's version again on top of
// theirs, which stays in the Expense's History; keep theirs drops this device's changes, which
// never reached the server, for good. Either returns to the detail page.
definePageMeta({ viewTransition: { toTypes: ['forward'], fromTypes: ['back'] } });

const { trip, claim, keepMine, discardChanges } = useOpenTrip();
const { t, locale } = useI18n();
const route = useRoute();
const back = useBack();

const expenseId = String(route.params.expenseId);
const detail = computed(() => `/trips/${trip.value.id}/expenses/${expenseId}`);

const conflict = computed(() => {
  const mine = findExpense(trip.value, expenseId);
  if (mine?.unsynced?.status !== 'conflict') return null;
  const held = mine.unsynced;
  const author = trip.value.participants.find(({ id }) => id === held.currentClaimId)?.name;
  const at = held.current.edited?.at;
  return {
    mine,
    theirs: held.current,
    author,
    // When the other version was made, by the server's clock.
    theirsWhen: at
      ? t('conflict.changedWhen', {
          when: formatTimeAgo(at, new Date(), locale.value, t('history.justNow')),
        })
      : undefined,
    changed: changedFields(held.current, mine),
  };
});

const resolving = ref(false);

async function resolve(keep: (expenseId: string) => Promise<void>): Promise<void> {
  resolving.value = true;
  try {
    await keep(expenseId);
    await back(detail.value);
  } finally {
    resolving.value = false;
  }
}

useHead({ title: () => t('conflict.title') });
</script>

<template>
  <NuxtLayout name="form" :title="$t('conflict.title')" :parent="detail">
    <template v-if="conflict">
      <p class="mb-4 px-1 text-toned">
        {{
          conflict.author
            ? $t('conflict.helpNamed', { name: conflict.author })
            : $t('conflict.help')
        }}
      </p>
      <div class="flex flex-col gap-3">
        <ExpenseVersion
          :heading="$t('conflict.mine')"
          :expense="conflict.mine"
          :deleted="conflict.mine.deleted"
          :changed="conflict.changed"
          :claim-id="claim?.id ?? null"
          :participants="trip.participants"
        >
          <p class="mb-2.5 flex gap-2 px-1 text-sm text-muted">
            <UIcon name="i-lucide-history" class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {{
              conflict.author
                ? $t('conflict.keepMineHelpNamed', { name: conflict.author })
                : $t('conflict.keepMineHelp')
            }}
          </p>
          <UButton
            block
            size="xl"
            variant="soft"
            :disabled="resolving"
            :label="$t('conflict.keepMine')"
            @click="resolve(keepMine)"
          />
        </ExpenseVersion>
        <ExpenseVersion
          :heading="
            conflict.author
              ? $t('conflict.theirsNamed', { name: conflict.author })
              : $t('conflict.theirs')
          "
          :subtitle="conflict.theirsWhen"
          :expense="conflict.theirs"
          :deleted="conflict.theirs.deleted"
          :changed="conflict.changed"
          :claim-id="claim?.id ?? null"
          :participants="trip.participants"
        >
          <p class="mb-2.5 flex gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm text-highlighted">
            <UIcon
              name="i-lucide-triangle-alert"
              class="mt-0.5 size-4 shrink-0 text-warning"
              aria-hidden="true"
            />
            {{ $t('conflict.keepTheirsHelp') }}
          </p>
          <UButton
            block
            size="xl"
            variant="soft"
            :disabled="resolving"
            :label="
              conflict.author
                ? $t('conflict.keepTheirsNamed', { name: conflict.author })
                : $t('conflict.keepTheirs')
            "
            @click="resolve(discardChanges)"
          />
        </ExpenseVersion>
      </div>
    </template>
    <UEmpty v-else icon="i-lucide-circle-check" variant="naked" :title="$t('conflict.none')" />
  </NuxtLayout>
</template>

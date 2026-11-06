import { neededRates, type Currency, type Expense, type RateLookup } from '@osi/owe-yeah-domain';

/**
 * What is known of the automatic rate an Expense being typed needs, beyond the rates on the
 * device: `found` (now among them), `notCovered` by the provider, `unknown` until it syncs
 * (offline, the server can't be reached, or it can't tell yet), or `checking` while the
 * server is asked. `null` when no rate is needed, or the device has the fixed one.
 */
export type RateLookupStatus = RateLookup['status'] | 'checking' | null;

// How long typing pauses before the rate is looked up.
const LOOKUP_DELAY_MS = 400;

/**
 * Looks up the automatic rate the Expense `typed` needs from the server, ahead of the pull
 * (`lookupRate`), so a currency or date the Trip hasn't used yet converts while it is typed:
 * again whenever the currency or local date changes, or the device comes back online. Only
 * the latest answer counts. A found entry joins the open Trip's rates, which convert it.
 */
export function useRateLookup(
  typed: () => Pick<Expense, 'currency' | 'time' | 'manualRate'> | null,
): Readonly<Ref<RateLookupStatus>> {
  const { trip, lookupRate } = useOpenTrip();

  const online = ref(navigator.onLine);
  const goneOnline = () => (online.value = true);
  const goneOffline = () => (online.value = false);
  onMounted(() => {
    window.addEventListener('online', goneOnline);
    window.addEventListener('offline', goneOffline);
  });
  onBeforeUnmount(() => {
    window.removeEventListener('online', goneOnline);
    window.removeEventListener('offline', goneOffline);
  });

  // The rate to look up; `null` when none is needed or the device has it fixed already.
  const wanted = computed(() => {
    const conversion = typed();
    const [needed] = conversion ? neededRates([conversion], trip.value.currency) : [];
    if (!needed) return null;
    const fixed = trip.value.rates.some(
      (entry) =>
        entry.fixed &&
        entry.date === needed.date &&
        entry.from === needed.from &&
        entry.to === trip.value.currency,
    );
    return fixed ? null : needed;
  });
  const wantedKey = computed(() => wanted.value && `${wanted.value.date} ${wanted.value.from}`);

  // The latest answer, for the currency asked about. One for an earlier date stands while the
  // new date is asked about, so a section it opened doesn't close and open again.
  const answer = ref<{ from: Currency; status: RateLookup['status'] } | null>(null);

  watch(
    [wantedKey, online],
    (_, __, onCleanup) => {
      const needed = wanted.value;
      if (!needed || !online.value) return;
      let latest = true;
      const timer = setTimeout(async () => {
        const status = await lookupRate(needed.from, needed.date).then(
          (found) => found.status,
          () => 'unknown' as const,
        );
        if (latest) answer.value = { from: needed.from, status };
      }, LOOKUP_DELAY_MS);
      onCleanup(() => {
        latest = false;
        clearTimeout(timer);
      });
    },
    { immediate: true },
  );

  return computed(() => {
    if (!wanted.value) return null;
    if (!online.value) return 'unknown';
    return answer.value?.from === wanted.value.from ? answer.value.status : 'checking';
  });
}

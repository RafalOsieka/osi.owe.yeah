import type { ReminderStatus, SuggestedRepayment } from '@osi/owe-yeah-domain';
import type { Reminded } from '~/sync/device';

/**
 * How a creditor's Remind button reminds its debtor, as it says before it is tapped: by push
 * notification, by a message shared from the share sheet (or copied, without one) when the
 * debtor can't be notified or this device is offline, not at all as the pair was reminded
 * today, or not yet known while the server is asked.
 */
export type RemindBy = 'push' | 'share' | 'copy' | 'remindedToday' | 'checking';

/**
 * Reminders by hand on the Balances tab (#42), for the claimed Participant's suggestions as
 * creditor: `by` says how each debtor would be reminded, `remind` reminds them. The server is
 * asked whom it can reach on open and on reconnect; offline, or when it can't be asked
 * (`offline`), Remind shares a pre-filled message instead.
 */
export function useReminders() {
  const { trip, claim, link, reminderStatus, remind: send } = useOpenTrip();
  const { t, locale } = useI18n();
  const toast = useToast();
  const canShare = 'share' in navigator;

  // `null` while the server can't be asked.
  const status = ref<ReminderStatus | 'checking' | null>(navigator.onLine ? 'checking' : null);
  // The debtor whose Reminder is on its way.
  const sending = ref<string | null>(null);

  async function refresh(): Promise<void> {
    try {
      status.value = await reminderStatus();
    } catch {
      status.value = null;
    }
  }
  const goneOffline = () => (status.value = null);
  onMounted(() => {
    if (navigator.onLine) void refresh();
    window.addEventListener('online', refresh);
    window.addEventListener('offline', goneOffline);
  });
  onBeforeUnmount(() => {
    window.removeEventListener('online', refresh);
    window.removeEventListener('offline', goneOffline);
  });

  const fallback = canShare ? 'share' : 'copy';

  function by(debtorId: string): RemindBy {
    const known = status.value;
    if (known === 'checking') return 'checking';
    if (known === null) return fallback;
    const from = claim.value?.id;
    if (known.remindedToday.some((pair) => pair.from === from && pair.to === debtorId)) {
      return 'remindedToday';
    }
    return known.reachable.includes(debtorId) ? 'push' : fallback;
  }

  /** The status as it is now with `change` made to it, once the server has said so. */
  function update(change: (known: ReminderStatus) => ReminderStatus): void {
    if (status.value !== null && status.value !== 'checking') status.value = change(status.value);
  }

  /**
   * Reminds the debtor of `suggestion` the way `by` says, falling back to sharing a message
   * when the push turns out not to reach them or the server can't be reached.
   */
  async function remind(suggestion: SuggestedRepayment): Promise<void> {
    const debtorId = suggestion.payerId;
    const debtor = trip.value.participants.find(({ id }) => id === debtorId);
    const from = claim.value?.id;
    if (!debtor || !from) return;

    if (by(debtorId) === 'push') {
      sending.value = debtorId;
      const reminded: Reminded | null = await send(debtorId).catch(() => null);
      sending.value = null;
      if (reminded === 'sent') {
        toast.add({ title: t('reminder.sent', { name: debtor.name }), icon: 'i-lucide-check' });
      }
      // Either way, the pair can't be reminded again today.
      if (reminded === 'sent' || reminded === 'remindedToday') {
        const pair = { from, to: debtorId };
        update((known) => ({ ...known, remindedToday: [...known.remindedToday, pair] }));
        return;
      }
      if (reminded === 'notSuggested') {
        toast.add({ title: t('reminder.notSuggested'), color: 'error' });
        return;
      }
      // Not reachable after all, or the server wasn't: a shared message reminds them instead.
      if (reminded === 'unreachable') {
        update((known) => ({
          ...known,
          reachable: known.reachable.filter((id) => id !== debtorId),
        }));
      } else {
        status.value = null;
      }
    }

    const amount = formatMoney(suggestion.amount, trip.value.currency, locale.value);
    const text = t('reminder.message', { name: debtor.name, amount, trip: trip.value.name });
    await share(link.value ? `${text}\n${link.value}` : text);
  }

  async function share(text: string): Promise<void> {
    if (canShare) {
      try {
        await navigator.share({ text });
        return;
      } catch (error) {
        // Closed without sharing; anything else, e.g. a refused share, falls back to copying.
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.add({ title: t('reminder.copied'), icon: 'i-lucide-check' });
    } catch {
      toast.add({ title: t('reminder.copyFailed'), color: 'error' });
    }
  }

  const offline = computed(() => status.value === null);

  return { by, offline, sending: readonly(sending), remind };
}

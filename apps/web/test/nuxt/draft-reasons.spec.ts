import { expenseProblemSchema, type TripWithParticipants } from '@osi/owe-yeah-domain';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import {
  newExpenseDraft,
  type DraftField,
  type DraftReason,
  type LineItemField,
  type SplitDraft,
} from '../../app/utils/expense-draft';

const trip: TripWithParticipants = {
  id: '019a2b3c-4d5e-7f00-8a1b-100000000001',
  name: 'Istria 2026',
  currency: 'EUR',
  participants: [{ id: '019a2b3c-4d5e-7f00-8a1b-000000000001', name: 'Kasia' }],
};

const FIELDS = {
  title: true,
  amount: true,
  manualRate: true,
  mainPayerId: true,
  recipientId: true,
  participantIds: true,
  local: true,
  lineItems: true,
  discount: true,
  contributions: true,
} satisfies Record<DraftField, true>;

const LINE_ITEM_FIELDS = {
  price: true,
  amount: true,
  discount: true,
  deposit: true,
  amounts: true,
} satisfies Record<LineItemField, true>;

/** `useDraftReasons` as a form gets it. */
async function draftReasons(): Promise<ReturnType<typeof useDraftReasons>> {
  let reasons: ReturnType<typeof useDraftReasons> | undefined;
  await mountSuspended(
    defineComponent({
      setup() {
        reasons = useDraftReasons();
        return () => null;
      },
    }),
  );
  return reasons!;
}

/** Every reason a draft can give, at every field it can give it. */
const everyReason: DraftReason[] = [
  ...Object.keys(FIELDS).flatMap((field) =>
    (['missing', 'unreadable', 'tooLong'] as const).map((code) => ({
      // SAFETY: the keys of `FIELDS`, which names every field.
      field: field as DraftField,
      code,
    })),
  ),
  ...expenseProblemSchema.options.map((code) => ({ field: 'title' as const, code })),
];

describe('the reasons an Expense draft gives', () => {
  afterEach(async () => {
    await useNuxtApp().$i18n.setLocale('en');
  });

  it.each(['en', 'pl'] as const)('all have words in %s', async (locale) => {
    const { draftReason, lineItemReason } = await draftReasons();
    await useNuxtApp().$i18n.setLocale(locale);
    const draft = newExpenseDraft(trip, {
      now: new Date(),
      zone: 'Europe/Zagreb',
      claimId: null,
      lastCurrency: null,
    });
    const drafts: SplitDraft[] = [
      draft,
      { ...draft, received: true, manualRate: { ...draft.manualRate, kind: 'rate' } },
    ];

    const messages = [
      ...drafts.flatMap((typed) => everyReason.map((reason) => draftReason(reason, typed))),
      ...Object.keys(LINE_ITEM_FIELDS).map((field) =>
        // SAFETY: the keys of `LINE_ITEM_FIELDS`, which names every field.
        lineItemReason({ field: field as LineItemField, code: 'unreadable' }),
      ),
    ];

    // A missing message reads as its key, e.g. `receipt.checkPrice`.
    expect(messages.filter((message) => /^\w+(\.\w+)+$/.test(message))).toEqual([]);
  });
});

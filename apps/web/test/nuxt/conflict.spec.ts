import type { Expense, Participant } from '@osi/owe-yeah-domain';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import { computed, ref } from 'vue';
import Conflict from '../../app/pages/trips/[id]/expenses/[expenseId]/conflict.vue';
import ExpenseDetailPage from '../../app/pages/trips/[id]/expenses/[expenseId]/index.vue';
import type { LocalExpense } from '../../app/sync/local-trip';

const kasia: Participant = { id: '019a2b3c-4d5e-7f00-8a1b-000000000001', name: 'Kasia' };
const marta: Participant = { id: '019a2b3c-4d5e-7f00-8a1b-000000000002', name: 'Marta' };
// Removed from the Trip after she paid for the Expense and changed it.
const ewa: Participant = { id: '019a2b3c-4d5e-7f00-8a1b-000000000003', name: 'Ewa' };

const tripId = '019a2b3c-4d5e-7f00-8a1b-2c3d4e5f6a7b';
const expenseId = '019a2b3c-4d5e-7f00-8a1b-200000000001';

// A dinner Ewa paid for, Even between the given Participants.
function dinner(participantIds: string[]): Expense {
  return {
    id: expenseId,
    title: 'Dinner',
    currency: 'EUR',
    time: { instant: '2026-07-14T19:30:00Z', zone: 'Europe/Zagreb' },
    mainPayerId: ewa.id,
    lineItems: [
      { name: '', unitPrice: 4500, quantity: 1, split: { mode: 'even', participantIds } },
    ],
  };
}

// This device's version is for Kasia and Marta, everyone in the Trip now; Ewa's, on the
// server, is for Marta and her, as many people as the Trip has but not the same ones.
const mine: LocalExpense = {
  ...dinner([kasia.id, marta.id]),
  deleted: false,
  edited: { by: kasia.id, at: null },
  revision: null,
  base: { version: 1 },
  unsynced: {
    status: 'conflict',
    changeId: '019a2b3c-4d5e-7f00-8a1b-300000000001',
    claimId: kasia.id,
    current: {
      ...dinner([marta.id, ewa.id]),
      version: 2,
      deleted: false,
      edited: { by: ewa.id, at: '2026-07-14T20:00:00Z' },
    },
    currentClaimId: ewa.id,
  },
};

mockNuxtImport('useOpenTrip', () => () => ({
  trip: computed(() => ({
    id: tripId,
    currency: 'EUR',
    participants: [kasia, marta],
    removedParticipants: [ewa],
    expenses: [mine],
    deletedExpenses: [],
    rates: [],
  })),
  claim: ref(kasia),
  everyone: ref([kasia, marta, ewa]),
}));

describe('a Conflict over an Expense with a removed Participant', () => {
  it('names the removed Participant on both versions and as the other side', async () => {
    const page = await mountSuspended(Conflict, {
      route: `/trips/${tripId}/expenses/${expenseId}/conflict`,
    });
    const [yours, theirs] = page.findAll('section').map((card) => card.text());

    expect(page.text()).toContain('You and Ewa changed this Expense');
    expect(yours).toContain('Paid by Ewa');
    expect(yours).toContain('For all 2');
    expect(theirs).toContain("Ewa's change");
    expect(theirs).toContain('Paid by Ewa');
    expect(theirs).toContain('For Marta and Ewa');
  });
});

describe("an Expense's detail page with a Conflict from a removed Participant", () => {
  it('names her in the Conflict notice', async () => {
    const page = await mountSuspended(ExpenseDetailPage, {
      route: `/trips/${tripId}/expenses/${expenseId}`,
    });

    expect(page.text()).toContain('Ewa changed this Expense too');
  });
});

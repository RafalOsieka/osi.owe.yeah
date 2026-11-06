import type { Participant } from '@osi/owe-yeah-domain';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import { computed, ref } from 'vue';
import RecentlyDeleted from '../../app/pages/trips/[id]/deleted.vue';
import type { LocalEdited, LocalExpense } from '../../app/sync/local-trip';

const kasia: Participant = { id: '019a2b3c-4d5e-7f00-8a1b-000000000001', name: 'Kasia' };

// The page reads the open Trip only; each test sets what it holds.
const open = { claim: ref<Participant | null>(null), deleted: ref<LocalExpense[]>([]) };

mockNuxtImport('useOpenTrip', () => () => ({
  trip: computed(() => ({
    id: '019a2b3c-4d5e-7f00-8a1b-2c3d4e5f6a7b',
    deletedExpenses: open.deleted.value,
  })),
  claim: open.claim,
  everyone: ref([kasia]),
  saveExpense: async () => [],
}));

function deletedLidl(edited: LocalEdited | null): LocalExpense {
  return {
    id: '019a2b3c-4d5e-7f00-8a1b-200000000001',
    title: 'Lidl Rovinj',
    currency: 'EUR',
    time: { instant: '2026-07-14T21:30:00Z', zone: 'Europe/Zagreb' },
    mainPayerId: kasia.id,
    lineItems: [
      {
        name: '',
        unitPrice: 2450,
        quantity: 1,
        split: { mode: 'even', participantIds: [kasia.id] },
      },
    ],
    deleted: true,
    edited,
    base: { version: 2 },
    unsynced: null,
  };
}

async function deletedLine(claim: Participant | null, edited: LocalEdited | null): Promise<string> {
  open.claim.value = claim;
  open.deleted.value = [deletedLidl(edited)];
  const wrapper = await mountSuspended(RecentlyDeleted);
  return wrapper.find('li').text();
}

describe('Recently deleted', () => {
  it("reads neutrally when neither the Claim nor the deletion's author is known", async () => {
    const line = await deletedLine(null, null);

    expect(line).toContain('Deleted not synced yet');
    expect(line).not.toContain('by you');
  });

  it('says "by you" when the claimed Participant deleted it', async () => {
    const line = await deletedLine(kasia, { by: kasia.id, at: null });

    expect(line).toContain('Deleted by you');
  });
});

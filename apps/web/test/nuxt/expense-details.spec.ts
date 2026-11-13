import type { Expense, Participant } from '@osi/owe-yeah-domain';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import { computed, ref } from 'vue';
import ExpenseDetails from '../../app/components/ExpenseDetails.vue';
import { withOpenTrip } from './open-trip';

const kasia: Participant = { id: '019a2b3c-4d5e-7f00-8a1b-000000000001', name: 'Kasia' };
const marta: Participant = { id: '019a2b3c-4d5e-7f00-8a1b-000000000002', name: 'Marta' };
// Added to the Trip and removed again, on no Expense.
const ewa: Participant = { id: '019a2b3c-4d5e-7f00-8a1b-000000000003', name: 'Ewa' };

const openTrip = withOpenTrip({
  trip: computed(() => ({
    id: '019a2b3c-4d5e-7f00-8a1b-2c3d4e5f6a7b',
    currency: 'EUR',
    participants: [kasia, marta],
    removedParticipants: [ewa],
  })),
  claim: ref(kasia),
  everyone: ref([kasia, marta, ewa]),
});

// Bread and cheese nobody has been given yet, €10.00 and €30.00, with €4.00 off the Receipt:
// €9.00 and €27.00 of the €36.00 unassigned after it.
const lidl: Expense = {
  id: '019a2b3c-4d5e-7f00-8a1b-200000000001',
  title: 'Lidl Rovinj',
  currency: 'EUR',
  time: { instant: '2026-07-14T21:30:00Z', zone: 'Europe/Zagreb' },
  mainPayerId: kasia.id,
  lineItems: [
    { name: 'Bread', unitPrice: 1000, quantity: 1, split: { mode: 'even', participantIds: [] } },
    { name: 'Cheese', unitPrice: 3000, quantity: 1, split: { mode: 'even', participantIds: [] } },
  ],
  discount: { kind: 'amount', amount: 400 },
};

describe('a Receipt with a Receipt discount and several unassigned Line items', () => {
  it('says on each line what it comes to after the Receipt discount', async () => {
    const wrapper = await mountSuspended(ExpenseDetails, { props: { expense: lidl }, ...openTrip });

    expect(wrapper.text()).toContain('€36.00 unassigned');
    expect(wrapper.findAll('li[id]').map((line) => line.text())).toEqual([
      expect.stringContaining('€10.00 not assigned yet (€9.00 after the Receipt discount)'),
      expect.stringContaining('€30.00 not assigned yet (€27.00 after the Receipt discount)'),
    ]);
  });
});

describe('a Receipt in a Trip with a removed Participant', () => {
  it('says an Even line for every current Participant is for all of them', async () => {
    const { discount: _, ...undiscounted } = lidl;
    const receipt: Expense = {
      ...undiscounted,
      lineItems: [
        {
          name: 'Bread',
          unitPrice: 129,
          quantity: 2,
          split: { mode: 'even', participantIds: [kasia.id, marta.id] },
        },
      ],
    };
    const wrapper = await mountSuspended(ExpenseDetails, {
      props: { expense: receipt },
      ...openTrip,
    });

    expect(wrapper.find('li[id]').text()).toContain('2 × €1.29 · Even · for all 2');
  });
});

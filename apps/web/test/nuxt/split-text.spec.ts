import type { LineItem, Participant } from '@osi/owe-yeah-domain';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { draftSplit } from '../../app/utils/expense-draft';

const kasia: Participant = { id: '019a2b3c-4d5e-7f00-8a1b-000000000001', name: 'Kasia' };
const marta: Participant = { id: '019a2b3c-4d5e-7f00-8a1b-000000000002', name: 'Marta' };
const tomek: Participant = { id: '019a2b3c-4d5e-7f00-8a1b-000000000003', name: 'Tomek' };
const participants = [kasia, marta, tomek];

/** `useSplitText` as a form gets it. */
async function splitText(): Promise<ReturnType<typeof useSplitText>> {
  let text: ReturnType<typeof useSplitText> | undefined;
  await mountSuspended(
    defineComponent({
      setup() {
        text = useSplitText();
        return () => null;
      },
    }),
  );
  return text!;
}

// €20.00 split by Amounts: Kasia €10.00, Marta €5.00, the other €5.00 unassigned.
const line: LineItem = {
  name: 'Olive oil',
  unitPrice: 2000,
  quantity: 1,
  split: {
    mode: 'amounts',
    parts: [
      { participantId: kasia.id, amount: 1000 },
      { participantId: marta.id, amount: 500 },
    ],
  },
};

describe('an Amounts split as a line reads it', () => {
  it('shows the amounts as typed without a Line discount', async () => {
    const text = await splitText();
    expect(text(draftSplit(line.split, 'EUR'), participants, 'EUR', line)).toBe(
      'Amounts · Kasia €10.00, Marta €5.00',
    );
  });

  it('shows each Share after a Line discount, and says so', async () => {
    const text = await splitText();
    const discounted: LineItem = { ...line, discount: { kind: 'percent', basisPoints: 2500 } };
    expect(text(draftSplit(discounted.split, 'EUR'), participants, 'EUR', discounted)).toBe(
      'Amounts after the Line discount · Kasia €7.50, Marta €3.75',
    );
  });
});

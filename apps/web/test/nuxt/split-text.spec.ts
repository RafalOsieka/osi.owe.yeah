import { add, lineItemShares, type LineItem, type Participant } from '@osi/owe-yeah-domain';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { draftSplit } from '../../app/utils/expense-draft';

const kasia: Participant = { id: '019a2b3c-4d5e-7f00-8a1b-000000000001', name: 'Kasia' };
const marta: Participant = { id: '019a2b3c-4d5e-7f00-8a1b-000000000002', name: 'Marta' };
const tomek: Participant = { id: '019a2b3c-4d5e-7f00-8a1b-000000000003', name: 'Tomek' };
const participants = [kasia, marta, tomek];

/** A wording composable as a form gets it, e.g. `useSplitText`. */
async function composed<T>(use: () => T): Promise<T> {
  let made: { value: T } | undefined;
  await mountSuspended(
    defineComponent({
      setup() {
        made = { value: use() };
        return () => null;
      },
    }),
  );
  return made!.value;
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
    const text = await composed(useSplitText);
    expect(text(draftSplit(line.split, 'EUR'), participants, { currency: 'EUR', item: line })).toBe(
      'Amounts · Kasia €10.00, Marta €5.00',
    );
  });

  it('shows each Share after a Line discount, and says so', async () => {
    const text = await composed(useSplitText);
    const discounted: LineItem = { ...line, discount: { kind: 'percent', basisPoints: 2500 } };
    expect(
      text(draftSplit(discounted.split, 'EUR'), participants, {
        currency: 'EUR',
        item: discounted,
      }),
    ).toBe('Amounts after the Line discount · Kasia €7.50, Marta €3.75');
  });
});

describe('an Even split against the current Participants', () => {
  // Removed from the Trip, still named on older Revisions.
  const ewa: Participant = { id: '019a2b3c-4d5e-7f00-8a1b-000000000004', name: 'Ewa' };
  const everyone = [...participants, ewa];

  it('is for all of them when it names each current Participant', async () => {
    const text = await composed(useSplitText);
    const split = draftSplit(
      { mode: 'even', participantIds: participants.map(({ id }) => id) },
      'EUR',
    );
    expect(text(split, participants, { everyone })).toBe('Even · for all 3');
  });

  it('names them when it includes a removed Participant instead of a current one', async () => {
    const text = await composed(useSplitText);
    const split = draftSplit({ mode: 'even', participantIds: [kasia.id, marta.id, ewa.id] }, 'EUR');
    expect(text(split, participants, { everyone })).toBe('Even · Kasia, Marta, Ewa');
  });
});

describe('the headline of what is not assigned yet', () => {
  // 6 × €0.29 water of which Kasia took 2 and Marta 1, and 4 × €1.20 beer Tomek took 3 of.
  const water: LineItem = {
    name: 'Water',
    unitPrice: 29,
    quantity: 6,
    split: {
      mode: 'units',
      parts: [
        { participantId: kasia.id, units: 2 },
        { participantId: marta.id, units: 1 },
      ],
    },
  };
  const beer: LineItem = {
    name: 'Beer',
    unitPrice: 120,
    quantity: 4,
    split: { mode: 'units', parts: [{ participantId: tomek.id, units: 3 }] },
  };

  /** The headline of a Receipt of `lineItems` paid by Kasia. */
  async function headlineOf(lineItems: LineItem[], yours = false) {
    const shares = lineItems.map((item) => lineItemShares(item, 'EUR'));
    return (await composed(useUnassignedHeadline))({
      lineItems: shares,
      unassigned: shares.map(({ unassigned }) => unassigned).reduce(add),
      currency: 'EUR',
      payer: kasia,
      yours,
    });
  }

  it('counts units while every Line item with value unassigned is split by Units', async () => {
    expect(await headlineOf([water, beer])).toEqual({
      text: "4 units unassigned · Kasia's for now",
      inUnits: true,
    });
  });

  it('says the amount once one of them is not, and whose it is for now', async () => {
    const bread: LineItem = {
      name: 'Bread',
      unitPrice: 150,
      quantity: 1,
      split: { mode: 'even', participantIds: [] },
    };
    expect(await headlineOf([water, bread], true)).toEqual({
      text: '€2.37 unassigned · yours for now',
      inUnits: false,
    });
  });

  it('is nothing once every Line item is assigned in full', async () => {
    const allTaken: LineItem = { ...beer, split: { mode: 'even', participantIds: [tomek.id] } };
    expect(await headlineOf([allTaken])).toBeNull();
  });
});

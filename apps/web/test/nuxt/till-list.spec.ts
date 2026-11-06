import type { Participant } from '@osi/owe-yeah-domain';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import type { VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import TillList from '../../app/components/TillList.vue';
import type { DraftLineItem } from '../../app/utils/expense-draft';

const participants: Participant[] = [
  { id: '019a2b3c-4d5e-7f00-8a1b-000000000001', name: 'Kasia' },
  { id: '019a2b3c-4d5e-7f00-8a1b-000000000002', name: 'Ania' },
];

/** The Till list as the Receipt form holds it, with its `pending` flag to read. */
async function tillList(): Promise<{ wrapper: VueWrapper; pending: () => boolean }> {
  const pending = ref(false);
  const lineItems = ref<DraftLineItem[]>([]);
  const wrapper = await mountSuspended(
    defineComponent({
      setup: () => () =>
        h(TillList, {
          participants,
          currency: 'EUR',
          modelValue: lineItems.value,
          'onUpdate:modelValue': (value: DraftLineItem[]) => (lineItems.value = value),
          pending: pending.value,
          'onUpdate:pending': (value: boolean) => (pending.value = value),
        }),
    }),
  );
  return { wrapper, pending: () => pending.value };
}

async function click(wrapper: VueWrapper, label: string): Promise<void> {
  const button = wrapper.findAll('button').find((b) => b.text() === label);
  if (!button) throw new Error(`No "${label}" button`);
  await button.trigger('click');
}

const input = (wrapper: VueWrapper, label: string) =>
  wrapper.find<HTMLInputElement>(`input[aria-label="${label}"]`);

describe('TillList', () => {
  it('keeps typed goods pending while the Deposit refund form opens', async () => {
    const { wrapper, pending } = await tillList();
    await click(wrapper, 'Add a Line item');
    await input(wrapper, 'New Line item name').setValue('Mineral water');
    expect(pending()).toBe(true);

    await click(wrapper, 'Add a Deposit refund');

    expect(pending()).toBe(true);
    expect(input(wrapper, 'New Line item name').element.value).toBe('Mineral water');
  });

  it('keeps a typed Deposit refund pending while the goods form opens', async () => {
    const { wrapper, pending } = await tillList();
    await click(wrapper, 'Add a Deposit refund');
    await input(wrapper, 'Deposit refund amount').setValue('1');

    await click(wrapper, 'Add a Line item');

    expect(pending()).toBe(true);
    expect(input(wrapper, 'Deposit refund amount').exists()).toBe(true);
  });

  it('keeps goods with only a Deposit per unit typed pending', async () => {
    const { wrapper, pending } = await tillList();
    await click(wrapper, 'Add a Line item');
    await input(wrapper, 'New Line item Deposit per unit').setValue('0,25');

    await click(wrapper, 'Add a Deposit refund');

    expect(pending()).toBe(true);
    expect(input(wrapper, 'New Line item Deposit per unit').exists()).toBe(true);
  });

  it('folds an empty add form when the other one opens', async () => {
    const { wrapper } = await tillList();
    await click(wrapper, 'Add a Line item');

    await click(wrapper, 'Add a Deposit refund');

    expect(input(wrapper, 'New Line item name').exists()).toBe(false);
  });

  it('clears what was typed on Discard', async () => {
    const { wrapper, pending } = await tillList();
    await click(wrapper, 'Add a Line item');
    await input(wrapper, 'New Line item name').setValue('Mineral water');

    await click(wrapper, 'Discard');
    expect(pending()).toBe(false);
    await click(wrapper, 'Add a Line item');

    expect(input(wrapper, 'New Line item name').element.value).toBe('');
  });
});

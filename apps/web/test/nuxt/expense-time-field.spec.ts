import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import ExpenseTimeField from '../../app/components/ExpenseTimeField.vue';

const local = '1998-12-31T12:00';

function mountWith(error?: string) {
  return mountSuspended(ExpenseTimeField, {
    props: { local, zone: 'Europe/Zagreb', error },
  });
}

describe('ExpenseTimeField', () => {
  it('folds the time into a chip while it breaks no rule', async () => {
    const wrapper = await mountWith();

    expect(wrapper.find('input[type="datetime-local"]').exists()).toBe(false);
  });

  it('shows the rule the time breaks under the unfolded field', async () => {
    const wrapper = await mountWith('The date must be between 4 January 1999 and a year from now.');

    expect(wrapper.find<HTMLInputElement>('input[type="datetime-local"]').element.value).toBe(
      local,
    );
    expect(wrapper.text()).toContain('The date must be between 4 January 1999');

    // Fixing the time doesn't fold the field away while it is typed in.
    await wrapper.setProps({ error: undefined });
    expect(wrapper.find('input[type="datetime-local"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('The date must be between');
  });
});

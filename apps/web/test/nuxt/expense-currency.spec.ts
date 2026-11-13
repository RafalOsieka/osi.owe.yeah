import { rational, type RateEntry, type RateLookup } from '@osi/owe-yeah-domain';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed, ref } from 'vue';
import ExpenseCurrency from '../../app/components/ExpenseCurrency.vue';
import { withOpenTrip } from './open-trip';

// How the server answers each lookup.
const server = vi.hoisted(() => ({
  lookupRate: vi.fn<(from: string, date: string) => Promise<RateLookup>>(),
}));

// The open Trip's rates on the device: none until a lookup brings one.
const rates = ref<RateEntry[]>([]);

const openTrip = withOpenTrip({
  trip: computed(() => ({
    id: '019a2b3c-4d5e-7f00-8a1b-2c3d4e5f6a7b',
    currency: 'EUR',
    rates: rates.value,
  })),
  // As the device does: a found entry joins the Trip's rates.
  async lookupRate(from: string, date: string) {
    const lookup = await server.lookupRate(from, date);
    if (lookup.status === 'found') rates.value = [...rates.value, lookup.entry];
    return lookup;
  },
});

afterEach(() => {
  rates.value = [];
  server.lookupRate.mockReset();
  vi.restoreAllMocks();
});

const huf = (date: string, rate: string, fixed: boolean): RateEntry => ({
  date,
  from: 'HUF',
  to: 'EUR',
  rate,
  fixed,
});

/** The section under an amount of 12,500 HUF spent in Budapest on `day`. */
function mountAt(day: string) {
  return mountSuspended(ExpenseCurrency, {
    props: {
      reading: {
        total: rational(12500n),
        time: { instant: `${day}T12:00:00Z`, zone: 'Europe/Budapest' },
        manualRate: undefined,
      },
      currency: 'HUF',
      manualRate: { kind: 'charged', value: '', currency: 'EUR' },
    },
    ...openTrip,
  });
}

/** `instant` as the `reading` prop of the section, for a later day. */
const readingOn = (day: string) => ({
  total: rational(12500n),
  time: { instant: `${day}T12:00:00Z`, zone: 'Europe/Budapest' },
  manualRate: undefined,
});

describe('the automatic rate of a currency the Trip has not used yet', () => {
  it("converts at the date's rate the server looks up, and follows the date", async () => {
    server.lookupRate.mockImplementation(async (_, date) => ({
      status: 'found',
      entry: date === '2026-11-01' ? huf(date, '0.0028', true) : huf(date, '0.003', false),
    }));
    const wrapper = await mountAt('2026-11-01');

    await vi.waitFor(() => expect(wrapper.text()).toContain('€35.00'));
    expect(wrapper.text()).not.toContain('≈');
    expect(server.lookupRate).toHaveBeenCalledWith('HUF', '2026-11-01');

    // The day's own rate is not fixed yet: a Provisional rate, so the amount is approximate.
    await wrapper.setProps({ reading: readingOn('2026-11-06') });
    await vi.waitFor(() => expect(wrapper.text()).toContain('≈ €37.50'));
    expect(server.lookupRate).toHaveBeenLastCalledWith('HUF', '2026-11-06');
  });

  it('asks for a Manual rate when the provider does not cover the currency', async () => {
    server.lookupRate.mockResolvedValue({ status: 'notCovered' });
    const wrapper = await mountAt('2026-11-01');

    await vi.waitFor(() =>
      expect(wrapper.text()).toContain("There's no automatic rate for HUF yet. Type one"),
    );
    expect(wrapper.find('section').exists()).toBe(true);
  });

  it('says the rate comes once synced while the server cannot be asked, without asking for a Manual rate', async () => {
    server.lookupRate.mockRejectedValue(new Error('offline'));
    const wrapper = await mountAt('2026-11-01');

    await vi.waitFor(() =>
      expect(wrapper.text()).toContain('The exchange rate arrives once synced'),
    );
    expect(wrapper.find('section').exists()).toBe(false);
    expect(wrapper.text()).toContain('Type a Manual rate');
  });

  it('says the rate comes once synced offline, without asking the server', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const wrapper = await mountAt('2026-11-01');

    expect(wrapper.text()).toContain('The exchange rate arrives once synced');
    expect(wrapper.find('section').exists()).toBe(false);
    expect(server.lookupRate).not.toHaveBeenCalled();
  });
});

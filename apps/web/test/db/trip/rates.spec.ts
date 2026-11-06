import type { RateLookup } from '@osi/owe-yeah-domain';
import { afterAll, expect, it } from 'vitest';
import { createRates } from '../../../server/trip/rates';
import { startFrankfurter } from '../../e2e/harness/frankfurter';
import { describeWithDocker } from '../../e2e/harness/postgres';
import { useMigratedDatabase } from '../database';

const describeDb = describeWithDocker();

// The rate provider the rate table fills from.
const frankfurter = await startFrankfurter();
afterAll(frankfurter.close);

describeDb('looking up one rate for the Expense form', () => {
  const db = useMigratedDatabase();

  it('finds the fixed rate of a covered currency on a date, and never fetches it again', async () => {
    frankfurter.set('2026-07-14', 'HUF', 'EUR', 0.0025);

    const found = await createRates(db(), frankfurter.url).lookup('2026-07-14', 'HUF', 'EUR');

    const entry = { date: '2026-07-14', from: 'HUF', to: 'EUR', rate: '0.0025', fixed: true };
    expect(found).toEqual<RateLookup>({ status: 'found', entry });
    const fetched = frankfurter.requests.length;
    frankfurter.set('2026-07-14', 'HUF', 'EUR', 0.003);
    // Another instance has no throttle to hold it back: the table's fixed entry does.
    const again = await createRates(db(), frankfurter.url).lookup('2026-07-14', 'HUF', 'EUR');
    expect(again).toEqual<RateLookup>({ status: 'found', entry });
    expect(frankfurter.requests.length).toBe(fetched);
  });

  it('says a currency the provider does not cover is not covered, also when asked again soon', async () => {
    const rates = createRates(db(), frankfurter.url);

    expect(await rates.lookup('2026-07-14', 'MNT', 'EUR')).toEqual({ status: 'notCovered' });
    const fetched = frankfurter.requests.length;
    expect(await rates.lookup('2026-07-14', 'MNT', 'EUR')).toEqual({ status: 'notCovered' });
    expect(frankfurter.requests.length).toBe(fetched);
  });

  it('says the rate is not known yet while the provider has none on or before the date', async () => {
    frankfurter.set('2026-07-20', 'RON', 'EUR', 0.2);

    const lookup = await createRates(db(), frankfurter.url).lookup('2026-07-14', 'RON', 'EUR');

    expect(lookup).toEqual({ status: 'unknown' });
  });

  it('says the rate is not known yet while the provider cannot be reached', async () => {
    const closed = await startFrankfurter();
    await closed.close();

    const lookup = await createRates(db(), closed.url).lookup('2026-07-14', 'CZK', 'EUR');

    expect(lookup).toEqual({ status: 'unknown' });
  });
});

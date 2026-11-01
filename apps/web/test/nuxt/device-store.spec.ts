import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it } from 'vitest';
import { DeviceDb } from '../../app/sync/db';

describe('the device store', () => {
  it('keeps the Trips opened before it existed, with their Trip links and Claims', async () => {
    const ania = { id: uuidv7(), name: 'Ania' };
    const opened = {
      id: uuidv7(),
      name: 'Croatia 2026',
      token: 'the-token',
      claim: ania,
      openedAt: '2026-07-01T10:00:00.000Z',
    };
    localStorage.setItem('owe-yeah:trips', JSON.stringify([opened, { id: 'unreadable' }]));

    const trips = await new DeviceDb(uuidv7()).trips.toArray();

    expect(trips).toEqual([
      {
        id: opened.id,
        token: 'the-token',
        claim: ania,
        openedAt: opened.openedAt,
        snapshot: null,
      },
    ]);
  });
});

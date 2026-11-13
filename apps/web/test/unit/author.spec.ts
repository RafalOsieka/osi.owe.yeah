import type { Participant } from '@osi/owe-yeah-domain';
import { describe, expect, it } from 'vitest';
import { whoMadeIt } from '../../app/utils/author';

const kasia: Participant = { id: '019a2b3c-4d5e-7f00-8a1b-000000000001', name: 'Kasia' };
const ania: Participant = { id: '019a2b3c-4d5e-7f00-8a1b-000000000002', name: 'Ania' };
// Removed from the Trip, but still among everyone it has had.
const tomek: Participant = { id: '019a2b3c-4d5e-7f00-8a1b-000000000003', name: 'Tomek' };
const everyone = [kasia, ania, tomek];

describe('whoMadeIt', () => {
  it('answers you for the claimed Participant', () => {
    expect(whoMadeIt(kasia.id, kasia, everyone)).toEqual({ is: 'you', participant: kasia });
  });

  it('names another Participant, a removed one included', () => {
    expect(whoMadeIt(ania.id, kasia, everyone)).toEqual({ is: 'named', participant: ania });
    expect(whoMadeIt(tomek.id, kasia, everyone)).toEqual({ is: 'named', participant: tomek });
  });

  it('names the author on a device with no Claim', () => {
    expect(whoMadeIt(kasia.id, null, everyone)).toEqual({ is: 'named', participant: kasia });
  });

  it('knows nobody when there is no author, even on a device with no Claim', () => {
    expect(whoMadeIt(null, kasia, everyone)).toEqual({ is: 'nobody' });
    expect(whoMadeIt(null, null, everyone)).toEqual({ is: 'nobody' });
    expect(whoMadeIt(undefined, null, everyone)).toEqual({ is: 'nobody' });
  });

  it('knows nobody when the author is not in the Trip', () => {
    expect(whoMadeIt('019a2b3c-4d5e-7f00-8a1b-000000000009', kasia, everyone)).toEqual({
      is: 'nobody',
    });
  });
});

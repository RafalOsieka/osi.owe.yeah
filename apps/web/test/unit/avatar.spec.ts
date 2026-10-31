import { describe, expect, it } from 'vitest';
import { AVATAR_COLORS, avatarColor } from '../../app/utils/avatar';

// Ids as one device creates them in the same millisecond: they differ only at the end.
const siblingIds = Array.from(
  { length: 64 },
  (_, index) => `019a2b3c-4d5e-7f00-8a1b-2c3d4e5f6a${index.toString(16).padStart(2, '0')}`,
);

describe('avatarColor', () => {
  it('spreads Participants created together over the whole palette', () => {
    const used = new Set(siblingIds.map(avatarColor));

    expect(used).toEqual(new Set(AVATAR_COLORS));
  });
});

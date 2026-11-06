import { describe, expect, it } from 'vitest';
import {
  AVATAR_COLORS,
  avatarColor,
  distinctAvatarColors,
  participantAvatarColors,
} from '../../app/utils/avatar';

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

describe('participantAvatarColors', () => {
  const [ola, kasia, marta, tomek] = ['Ola', 'Kasia', 'Marta', 'Tomek'].map((name, index) => ({
    id: siblingIds[index]!,
    name,
  }));

  it("keeps everyone else's colour when a Participant is removed", () => {
    const before = participantAvatarColors({
      participants: [ola!, kasia!, marta!, tomek!],
      removedParticipants: [],
    });
    const after = participantAvatarColors({
      participants: [ola!, marta!, tomek!],
      removedParticipants: [kasia!],
    });

    expect(after).toEqual(before);
  });

  it('gives the same colours whatever order a device has the Participants in', () => {
    const one = participantAvatarColors({ participants: [ola!, kasia!], removedParticipants: [] });
    const other = participantAvatarColors({
      participants: [kasia!, ola!],
      removedParticipants: [],
    });

    expect(other).toEqual(one);
  });

  it('gives the first six in a Trip, removed ones included, a colour each', () => {
    const people = siblingIds
      .slice(0, AVATAR_COLORS.length)
      .map((id, index) => ({ id, name: `P${index}` }));
    const colors = participantAvatarColors({
      participants: people.slice(2),
      removedParticipants: people.slice(0, 2),
    });

    expect(new Set(colors.values())).toEqual(new Set(AVATAR_COLORS));
  });
});

describe('distinctAvatarColors', () => {
  const trips = siblingIds.slice(0, AVATAR_COLORS.length);

  it('gives every id its own tint while one is free', () => {
    const tints = distinctAvatarColors(trips.toReversed());

    expect(new Set(tints.values())).toEqual(new Set(AVATAR_COLORS));
  });

  it('keeps the tints of older ids when a newer one comes', () => {
    const before = distinctAvatarColors(trips.slice(0, 3));
    const after = distinctAvatarColors(trips.slice(0, 4));

    for (const id of trips.slice(0, 3)) expect(after.get(id)).toBe(before.get(id));
  });
});

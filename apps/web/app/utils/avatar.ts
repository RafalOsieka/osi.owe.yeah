/**
 * The avatar backgrounds a Participant can get, all dark enough for a white initial.
 * Written out in full so Tailwind finds the classes; emerald is left to the primary color.
 */
export const AVATAR_COLORS = [
  'bg-sky-600',
  'bg-amber-600',
  'bg-violet-600',
  'bg-pink-600',
  'bg-orange-600',
  'bg-teal-600',
  'bg-indigo-600',
  'bg-rose-600',
] as const;

export type AvatarColor = (typeof AVATAR_COLORS)[number];

/**
 * A Participant's avatar color, picked from their id alone, so every device shows the
 * same one. The whole id is hashed: ids created in the same millisecond share their start.
 */
export function avatarColor(participantId: string): AvatarColor {
  let hash = 0;
  for (const char of participantId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

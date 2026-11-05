/**
 * The avatar colors a Participant can get, in an order that keeps neighbours far apart on the
 * colour wheel: an opaque soft tint with the initial in a deeper shade of the same hue, in
 * light and dark mode. Written out in full so Tailwind finds the classes; emerald is left to
 * the primary color and rose to owing.
 */
export const AVATAR_COLORS = [
  'bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200',
  'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200',
  'bg-lime-100 text-lime-800 dark:bg-lime-900 dark:text-lime-200',
  'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200',
  'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200',
  'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',
] as const;

export type AvatarColor = (typeof AVATAR_COLORS)[number];

/**
 * The avatar color of the Participant at `index` in their Trip's order, which every device
 * shares: the first eight in a Trip never share one.
 */
export function avatarColorAt(index: number): AvatarColor {
  return AVATAR_COLORS[index % AVATAR_COLORS.length]!;
}

/**
 * A Participant's avatar color, picked from their id alone, for one no longer in the Trip, so every device shows the
 * same one. The whole id is hashed: ids created in the same millisecond share their start.
 */
export function avatarColor(participantId: string): AvatarColor {
  let hash = 0;
  for (const char of participantId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

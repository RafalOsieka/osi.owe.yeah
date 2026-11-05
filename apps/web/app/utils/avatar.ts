/**
 * The avatar colors a Participant can get: a soft tint with its initial in a deeper shade of
 * the same hue, in light and dark mode. Written out in full so Tailwind finds the classes;
 * emerald is left to the primary color.
 */
export const AVATAR_COLORS = [
  'bg-sky-100 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300',
  'bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300',
  'bg-pink-100 text-pink-700 dark:bg-pink-400/15 dark:text-pink-300',
  'bg-orange-100 text-orange-700 dark:bg-orange-400/15 dark:text-orange-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-400/15 dark:text-teal-300',
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-300',
  'bg-lime-100 text-lime-800 dark:bg-lime-400/15 dark:text-lime-300',
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

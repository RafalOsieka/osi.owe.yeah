/**
 * The avatar colors a Participant can get, in an order that keeps neighbours far apart on the
 * colour wheel: an opaque soft tint with the initial in a deeper shade of the same hue, and in
 * dark mode the hue mixed into the card colour with a light initial. Written out in full so Tailwind finds the classes; emerald is left to
 * the primary color and rose to owing.
 */
export const AVATAR_COLORS = [
  'bg-sky-100 text-sky-800 dark:bg-[color-mix(in_oklab,var(--color-sky-500)_28%,var(--ui-bg))] dark:text-sky-200',
  'bg-amber-100 text-amber-800 dark:bg-[color-mix(in_oklab,var(--color-amber-500)_28%,var(--ui-bg))] dark:text-amber-200',
  'bg-violet-100 text-violet-800 dark:bg-[color-mix(in_oklab,var(--color-violet-500)_28%,var(--ui-bg))] dark:text-violet-200',
  'bg-lime-100 text-lime-800 dark:bg-[color-mix(in_oklab,var(--color-lime-500)_28%,var(--ui-bg))] dark:text-lime-200',
  'bg-pink-100 text-pink-800 dark:bg-[color-mix(in_oklab,var(--color-pink-500)_28%,var(--ui-bg))] dark:text-pink-200',
  'bg-teal-100 text-teal-800 dark:bg-[color-mix(in_oklab,var(--color-teal-500)_28%,var(--ui-bg))] dark:text-teal-200',
  'bg-orange-100 text-orange-800 dark:bg-[color-mix(in_oklab,var(--color-orange-500)_28%,var(--ui-bg))] dark:text-orange-200',
  'bg-indigo-100 text-indigo-800 dark:bg-[color-mix(in_oklab,var(--color-indigo-500)_28%,var(--ui-bg))] dark:text-indigo-200',
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
 * The avatar color picked from an id alone, so every device shows the same one: for a
 * Participant no longer in the Trip, and for a Trip's tile on My Trips. The whole id is
 * hashed: ids created in the same millisecond share their start.
 */
export function avatarColor(id: string): AvatarColor {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

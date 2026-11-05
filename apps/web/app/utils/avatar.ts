/**
 * The avatar colors a Participant can get, in an order that keeps neighbours far apart on the
 * colour wheel: an opaque soft tint with the initial in a deeper shade of the same hue, and in
 * dark mode the hue mixed into the card colour with a light initial. Written out in full so
 * Tailwind finds the classes. Identity tints are the one exception to the app's few colours,
 * so none is green or red, which mean money coming back and owing.
 */
export const AVATAR_COLORS = [
  'bg-sky-100 text-sky-800 dark:bg-[color-mix(in_oklab,var(--color-sky-500)_28%,var(--ui-bg))] dark:text-sky-200',
  'bg-amber-100 text-amber-800 dark:bg-[color-mix(in_oklab,var(--color-amber-500)_28%,var(--ui-bg))] dark:text-amber-200',
  'bg-violet-100 text-violet-800 dark:bg-[color-mix(in_oklab,var(--color-violet-500)_28%,var(--ui-bg))] dark:text-violet-200',
  'bg-cyan-100 text-cyan-800 dark:bg-[color-mix(in_oklab,var(--color-cyan-500)_28%,var(--ui-bg))] dark:text-cyan-200',
  'bg-orange-100 text-orange-800 dark:bg-[color-mix(in_oklab,var(--color-orange-500)_28%,var(--ui-bg))] dark:text-orange-200',
  'bg-indigo-100 text-indigo-800 dark:bg-[color-mix(in_oklab,var(--color-indigo-500)_28%,var(--ui-bg))] dark:text-indigo-200',
  'bg-stone-100 text-stone-800 dark:bg-[color-mix(in_oklab,var(--color-stone-500)_28%,var(--ui-bg))] dark:text-stone-200',
  'bg-purple-100 text-purple-800 dark:bg-[color-mix(in_oklab,var(--color-purple-500)_28%,var(--ui-bg))] dark:text-purple-200',
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

import type { RouteLocationRaw } from 'vue-router';

/**
 * Back as a phone app does it: to the previous screen when there is one, or else to
 * `parent`, the screen above this one (when the page was opened from a link).
 */
export function useBack(): (parent: RouteLocationRaw) => Promise<void> {
  const router = useRouter();
  return async (parent) => {
    if (router.options.history.state.back) router.back();
    else await router.replace(parent);
  };
}

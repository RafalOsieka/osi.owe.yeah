/**
 * Asks before a changed form is left, so nothing typed is lost by a stray ✕ or back swipe.
 * While `changed()`, leaving in the app (✕, back, the Android back gesture, any route change)
 * is cancelled and opens the discard confirm (`open`) instead; reloading or closing the tab
 * gets the browser's own warning. `discard` then completes the navigation that was asked for,
 * as it would have gone: back goes back, without the history gaining or losing an entry.
 * Back while the confirm is open closes it and keeps editing (`useCloseOnBack`). The form
 * calls `leave` right before its own navigation after a save, which never asks.
 */
export function useDiscardConfirm(changed: () => boolean) {
  const router = useRouter();
  const open = ref(false);
  // The form's own place in the history: a back or forward moves the browser off it before
  // the router's guards run.
  const position = () => Number(router.options.history.state.position);
  const at = position();
  let leaving = false;
  // Where the cancelled navigation was going, for `discard` to go after all.
  let resume = (): void => {};

  // First, so back while the confirm is open only closes it.
  useCloseOnBack(open);
  const stop = router.beforeEach((to) => {
    if (leaving || !changed()) return;
    const delta = position() - at;
    // Undone by the router, so the browser is back on the form; a link pushes, while ✕ on a
    // form opened from a link (no screen before it) replaces it with the screen above.
    if (delta !== 0) resume = () => router.go(delta);
    else if (router.options.history.state.back) resume = () => void router.push(to);
    else resume = () => void router.replace(to);
    open.value = true;
    return false;
  });
  onScopeDispose(stop);

  function warn(event: BeforeUnloadEvent): void {
    if (!leaving && changed()) event.preventDefault();
  }
  window.addEventListener('beforeunload', warn);
  onScopeDispose(() => window.removeEventListener('beforeunload', warn));

  return {
    open,
    /** Throws the changes away and goes where the person was going. */
    discard(): void {
      leaving = true;
      open.value = false;
      resume();
    },
    /** Lets the form's own navigation through, once what was typed is saved. */
    leave(): void {
      leaving = true;
    },
  };
}

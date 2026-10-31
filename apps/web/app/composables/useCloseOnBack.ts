/**
 * System back closes an open sheet first, as on a phone. While `open`, any navigation is
 * cancelled and closes the sheet instead; the router restores the URL, so the next back
 * leaves the page. Sheets cover the page, so nothing else navigates while one is open.
 */
export function useCloseOnBack(open: Ref<boolean>): void {
  const stop = useRouter().beforeEach(() => {
    if (!open.value) return;
    open.value = false;
    return false;
  });
  onScopeDispose(stop);
}

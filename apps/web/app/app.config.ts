export default defineAppConfig({
  ui: {
    colors: {
      primary: 'emerald',
      success: 'emerald',
      error: 'rose',
      warning: 'amber',
      neutral: 'stone',
    },
    // One corner scale: pill buttons, 12px fields, 18px cards (`card` in `main.css`), and
    // touch-sized fields everywhere; a page can still ask for a smaller one.
    button: { slots: { base: 'rounded-full' } },
    input: { slots: { base: 'rounded-lg' }, defaultVariants: { size: 'xl' } },
    selectMenu: { slots: { base: 'rounded-lg' }, defaultVariants: { size: 'xl' } },
    // Sheets open from the bottom of the app's centered column, not the whole window, with
    // rounder top corners than the cards on the page.
    drawer: {
      slots: {
        overlay: 'bg-black/40 backdrop-blur-[2px]',
        content: 'mx-auto max-w-120 rounded-t-3xl! ring-0',
        container: 'gap-5 px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]',
        title: 'text-lg',
      },
    },
    modal: {
      slots: { overlay: 'bg-black/40 backdrop-blur-[2px]', content: 'rounded-3xl ring-0' },
    },
  },
});

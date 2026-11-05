export default defineAppConfig({
  ui: {
    colors: {
      primary: 'emerald',
      success: 'emerald',
      error: 'red',
      warning: 'amber',
      neutral: 'stone',
    },
    // One corner scale: pill buttons, 12px fields, 18px cards (`card` in `main.css`), and
    // touch-sized fields everywhere; a page can still ask for a smaller one. Buttons from md up
    // are touch-sized too: 40, 44 and 48 px, and the default is 44.
    button: {
      slots: { base: 'rounded-full font-semibold' },
      variants: {
        size: {
          md: { base: 'min-h-10 min-w-10 justify-center px-3.5' },
          lg: { base: 'min-h-11 min-w-11 justify-center px-4' },
          xl: { base: 'min-h-12 min-w-12 justify-center px-5' },
        },
      },
      // A disabled solid button greys out, so it can't pass for a live one.
      compoundVariants: [
        {
          variant: 'solid',
          class:
            'disabled:bg-accented disabled:text-muted disabled:opacity-100 aria-disabled:bg-accented aria-disabled:text-muted aria-disabled:opacity-100',
        },
      ],
      defaultVariants: { size: 'lg' },
    },
    // Menu rows are touch-sized, under a quiet section label.
    dropdownMenu: {
      slots: {
        content: 'min-w-52 rounded-xl',
        item: 'min-h-11 px-3 text-base',
        label: 'px-3 pt-2 pb-1 text-xs font-medium text-muted',
      },
    },
    // Off reads as a control, not as a gap.
    switch: {
      slots: {
        base: 'data-[state=unchecked]:bg-neutral-300 dark:data-[state=unchecked]:bg-neutral-700',
      },
    },
    // Fields are 44 px, like the buttons beside them.
    input: {
      slots: { base: 'rounded-lg' },
      variants: { size: { xl: { base: 'h-11' } } },
      defaultVariants: { size: 'xl' },
    },
    selectMenu: {
      slots: { base: 'rounded-lg' },
      variants: { size: { xl: { base: 'h-11' } } },
      defaultVariants: { size: 'xl' },
    },
    // Steppers focus like every other field; their − and + stay neutral.
    inputNumber: {
      slots: {
        base: 'rounded-lg',
        increment: '[&_button]:text-default',
        decrement: '[&_button]:text-default',
      },
      variants: { size: { xl: { base: 'h-11' } } },
      defaultVariants: { size: 'xl' },
    },
    // Sheets open from the bottom of the app's centered column, not the whole window, with
    // rounder top corners than the cards on the page.
    drawer: {
      slots: {
        overlay: 'bg-black/30 dark:bg-black/60',
        content: 'mx-auto max-w-120 rounded-t-3xl! ring-0',
        container: 'gap-5 px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]',
        title: 'text-lg',
        description: 'text-pretty',
      },
    },
    modal: {
      slots: { overlay: 'bg-black/30 dark:bg-black/60', content: 'rounded-3xl ring-0' },
    },
  },
});

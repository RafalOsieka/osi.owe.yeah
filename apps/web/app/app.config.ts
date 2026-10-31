export default defineAppConfig({
  ui: {
    colors: {
      primary: 'emerald',
      neutral: 'slate',
    },
    // Sheets open from the bottom of the app's centered column, not the whole window.
    drawer: {
      slots: {
        content: 'mx-auto max-w-120',
      },
    },
  },
});

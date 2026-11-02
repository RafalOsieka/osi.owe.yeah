/**
 * Currencies as picker items, e.g. "EUR · Euro" in the current locale: `TRIP_CURRENCIES` for
 * a Trip currency, `CURRENCIES` for an Expense's.
 */
export function useCurrencyItems<C extends string>(codes: readonly C[]) {
  const { locale } = useI18n();
  return computed(() => {
    const names = new Intl.DisplayNames([locale.value], { type: 'currency' });
    return codes.map((code) => ({ value: code, label: `${code} · ${names.of(code)}` }));
  });
}

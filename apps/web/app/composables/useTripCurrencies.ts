import { TRIP_CURRENCIES } from '@osi/owe-yeah-domain';

/** Every Trip currency as a picker item, e.g. "EUR · Euro" in the current locale. */
export function useTripCurrencies() {
  const { locale } = useI18n();
  return computed(() => {
    const names = new Intl.DisplayNames([locale.value], { type: 'currency' });
    return TRIP_CURRENCIES.map((code) => ({ value: code, label: `${code} · ${names.of(code)}` }));
  });
}

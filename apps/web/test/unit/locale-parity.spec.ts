import { describe, expect, it } from 'vitest';
import en from '../../i18n/locales/en.json';
import pl from '../../i18n/locales/pl.json';

interface Catalog {
  readonly [key: string]: string | Catalog;
}

function isMessage(entry: string | Catalog): entry is string {
  return typeof entry === 'string';
}

// Dotted paths of every message in a catalog, e.g. `trips.title`.
function messagePaths(catalog: Catalog, prefix = ''): string[] {
  return Object.entries(catalog).flatMap(([key, entry]) =>
    isMessage(entry) ? [prefix + key] : messagePaths(entry, `${prefix}${key}.`),
  );
}

describe('locale catalogs', () => {
  it('pl has exactly the messages en has', () => {
    expect(messagePaths(pl).toSorted()).toEqual(messagePaths(en).toSorted());
  });
});

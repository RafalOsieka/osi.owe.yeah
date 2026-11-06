import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import pl from '../../i18n/locales/pl.json';

// The Polish UI names domain concepts only with GLOSSARY.md's `_Polish_` words, never with a
// word from a term's `_Polish avoid_` list (docs/agents/domain.md). The glossary is the only
// source: this test reads both lists from it. Entries with a parenthetical condition, such as
// "Zwrot (on its own)", need judgement and are left to review.

interface Catalog {
  readonly [key: string]: string | Catalog;
}

const glossary = readFileSync(new URL('../../../../GLOSSARY.md', import.meta.url), 'utf8');

function glossaryLines(label: string): string[] {
  return [...glossary.matchAll(new RegExp(`^${label}: (.+)$`, 'gm'))].map(([, list]) => list ?? '');
}

// Every canonical Polish name, e.g. "Zwrot kaucji", and the Split mode names in parentheses.
// Lowercase pieces are notes ("of a Podróż", "a term for code and docs only"), not names.
const canonical = glossaryLines('_Polish_')
  .flatMap((line) => line.split(/[(),;]/))
  .map((name) => name.trim())
  .filter((name) => /^\p{Lu}/u.test(name))
  .toSorted((a, b) => b.length - a.length);

const avoided = [
  ...new Set(
    glossaryLines('_Polish avoid_')
      .flatMap((line) => line.split(','))
      .map((word) => word.trim())
      .filter((word) => !word.includes('('))
      .map((word) => word.toLowerCase()),
  ),
];

// A word in any inflected form: its stem (without a final vowel or "ć") plus up to three
// letters, so "znajomy" also catches "znajomymi" and "płatność" catches "płatności".
function inflected(word: string): string {
  const stem = word.length > 4 && /[aeiouyąęóć]$/u.test(word) ? word.slice(0, -1) : word;
  return `${stem}\\p{L}{0,3}`;
}

function phrase(words: string): RegExp {
  const pattern = words.split(/\s+/).map(inflected).join('\\s+');
  return new RegExp(`(?<!\\p{L})${pattern}(?!\\p{L})`, 'giu');
}

// Words that share a stem with an avoided one but mean something else: the verb "wpisać"
// (type in), returnable ("zwrotne") packaging, "długo" (for long), a QR code.
const OTHER_WORDS = ['wpisz', 'wpisuj', 'wpisano', 'wpisany', 'zwrotne', 'długo', 'kod QR'];

// Avoided words a message uses in their plain, non-domain sense, as "<message>: <word>".
const PLAIN_SENSE = new Set([
  'privacy.storage.serviceWorker: kod', // program code
  'terms.provider.register: wpis', // the entry in the business register
  'terms.requirements.notifications: push', // the browser technology the terms require
  'terms.content.sensitive: tożsamość', // legal wording, not a Claim
]);

function isMessage(entry: string | Catalog): entry is string {
  return typeof entry === 'string';
}

function messages(catalog: Catalog, prefix = ''): [path: string, text: string][] {
  return Object.entries(catalog).flatMap(([key, entry]) =>
    isMessage(entry) ? [[prefix + key, entry]] : messages(entry, `${prefix}${key}.`),
  );
}

// Every avoided word in the catalog, as "<message>: <word>", once canonical names and
// look-alike words are blanked out.
const slips = messages(pl).flatMap(([path, text]) => {
  const rest = [...canonical, ...OTHER_WORDS].reduce(
    (masked, name) => masked.replace(phrase(name), ' '),
    text,
  );
  return avoided.filter((word) => phrase(word).test(rest)).map((word) => `${path}: ${word}`);
});

describe('pl catalog against GLOSSARY.md', () => {
  it('reads both lists from the glossary', () => {
    expect(canonical).toContain('Zwrot kaucji');
    expect(avoided).toContain('rozliczenie');
  });

  it('uses no avoided word for a domain concept', () => {
    expect(slips.filter((slip) => !PLAIN_SENSE.has(slip))).toEqual([]);
  });
});

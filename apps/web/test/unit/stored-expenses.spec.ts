import { expenseStateSchema } from '@osi/owe-yeah-domain';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

/**
 * Every shape of Expense state the server has stored in `expenses.state` and
 * `revisions.state`, one file per shape, each a few Expenses by name. Revisions keep every
 * shape forever, and a pull answers 500 for a Trip with a row it can't parse.
 *
 * A file here is never changed once it is on `main`. A change to the stored shape keeps the
 * files of the shapes before it, adds one for its own, and either migrates `expenses.state`
 * with SQL (a JSONB migration) or upgrades Revisions on read in the Trip store, which this
 * test then parses through, so every file here still parses.
 */
const fixtureFiles = import.meta.glob('./stored-expenses/*.json', {
  eager: true,
  import: 'default',
});

const fixtureFileSchema = z.record(z.string(), z.record(z.string(), z.json()));

const cases = Object.entries(fixtureFiles).flatMap(([file, expensesByName]) =>
  Object.entries(fixtureFileSchema.parse(expensesByName)).map(([name, state]) => ({
    file,
    name,
    state,
  })),
);

describe('every stored Expense shape', () => {
  it('has fixtures', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.for(cases)('$file $name still parses, keeping every field', ({ state }) => {
    expect(expenseStateSchema.parse(state)).toMatchObject(state);
  });
});

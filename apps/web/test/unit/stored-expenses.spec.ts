import { expenseStateSchema } from '@osi/owe-yeah-domain';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

/**
 * Every shape of Expense state the server has stored in `expenses.state` and
 * `revisions.state`, one file per shape, each a few Expenses by name. Revisions keep every
 * shape forever, and a pull answers 500 for a Trip with a row it can't parse.
 *
 * A file here is never changed once it is on `main`. A change to the stored shape keeps the
 * files of the shapes before it, adds one for its own, and brings old rows along: a SQL JSONB
 * migration for `expenses.state`, or an upgrade on read, which Revisions need since they are
 * never rewritten. An upgrade on read goes next to `expenseStateSchema`, so the Trip store and
 * this test both parse through it. A change that is not only additive then checks old files
 * against their upgraded form instead of field by field.
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

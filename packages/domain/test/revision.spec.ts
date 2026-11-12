import { describe, expect, it } from 'vite-plus/test';
import { revisionKind } from '@osi/owe-yeah-domain';

describe('revisionKind', () => {
  it.each([
    ['added', null, false],
    ['deleted', { deleted: false }, true],
    ['restored', { deleted: true }, false],
    ['edited', { deleted: false }, false],
  ] as const)('reads a change as %s', (kind, previous, deleted) => {
    expect(revisionKind(previous, deleted)).toBe(kind);
  });

  it('reads an Expense added and deleted in one change as added', () => {
    expect(revisionKind(null, true)).toBe('added');
  });

  it('reads a deletion over a deletion as deleted', () => {
    expect(revisionKind({ deleted: true }, true)).toBe('deleted');
  });
});

import { describe, expect, it } from 'vitest';
import { formatTimeAgo } from '../../app/utils/time-ago';

const now = new Date('2026-07-15T12:00:00Z');

describe('formatTimeAgo', () => {
  it('says how long ago, in the largest whole unit', () => {
    expect(formatTimeAgo('2026-07-15T11:59:30Z', now, 'en')).toBe('now');
    expect(formatTimeAgo('2026-07-15T11:15:00Z', now, 'en')).toBe('45 min. ago');
    expect(formatTimeAgo('2026-07-15T10:00:00Z', now, 'en')).toBe('2 hr. ago');
    expect(formatTimeAgo('2026-07-12T12:00:00Z', now, 'en')).toBe('3 days ago');
    expect(formatTimeAgo('2026-07-15T10:00:00Z', now, 'pl')).toBe('2 godz. temu');
  });
});

import { describe, expect, it } from 'vitest';
import { LruMap } from '../../server/utils/lru-map';

describe('LruMap', () => {
  it('stays within its limit under many distinct keys, keeping the newest', () => {
    const retryAt = new LruMap<string, number>(100);

    for (let day = 0; day < 1000; day++) retryAt.set(`day ${day} HUF EUR`, day);

    expect(retryAt.size).toBe(100);
    expect(retryAt.get('day 899 HUF EUR')).toBeUndefined();
    expect(retryAt.get('day 900 HUF EUR')).toBe(900);
    expect(retryAt.get('day 999 HUF EUR')).toBe(999);
  });

  it('drops the entry used least recently, read or written', () => {
    const map = new LruMap<string, number>(2);
    map.set('a', 1);
    map.set('b', 2);

    map.get('a');
    map.set('c', 3);
    expect(map.get('b')).toBeUndefined();

    map.set('a', 4);
    map.set('d', 5);
    expect(map.get('c')).toBeUndefined();
    expect(map.get('a')).toBe(4);
  });

  it('forgets a deleted entry', () => {
    const map = new LruMap<string, number>(2);
    map.set('a', 1);

    map.delete('a');

    expect(map.get('a')).toBeUndefined();
    expect(map.size).toBe(0);
  });
});

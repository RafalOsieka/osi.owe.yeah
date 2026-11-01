import { liveQuery } from 'dexie';

/**
 * The result of a device store query, kept current as the store changes (also from other
 * tabs). `undefined` until the first result arrives. Stops with the calling scope.
 */
export function useLiveQuery<T>(query: () => Promise<T>): Readonly<ShallowRef<T | undefined>> {
  const result = shallowRef<T>();
  const subscription = liveQuery(query).subscribe({ next: (value) => (result.value = value) });
  onScopeDispose(() => subscription.unsubscribe());
  return result;
}

/**
 * An Expense's Revisions from the server, newest first, fetched when a History page opens:
 * they are not pulled with the Trip, so History needs a connection.
 */
export function useRevisions(expenseId: string) {
  const { revisions } = useOpenTrip();
  return useLazyAsyncData(`revisions-${expenseId}`, () => revisions(expenseId));
}

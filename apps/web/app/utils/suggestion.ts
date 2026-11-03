import type { SuggestedRepayment } from '@osi/owe-yeah-domain';

/** Names one Suggested Repayment by its pair, e.g. to highlight it: `payerId→recipientId`. */
export function suggestionKey({
  payerId,
  recipientId,
}: Pick<SuggestedRepayment, 'payerId' | 'recipientId'>): string {
  return `${payerId}→${recipientId}`;
}

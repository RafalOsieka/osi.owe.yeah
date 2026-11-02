import { fromMinor, parseMoney, roundMoney, type Contribution } from '@osi/owe-yeah-domain';

/** A Contribution as the Expense form edits it, with its amount as typed. */
export type DraftContribution = { participantId: string; amount: string };

/** Saved Contributions as the Expense form edits them. */
export function draftFromContributions(
  contributions: readonly Contribution[] | undefined,
  currency: string,
): DraftContribution[] {
  return (contributions ?? []).map(({ participantId, amount }) => ({
    participantId,
    amount: roundMoney(fromMinor(amount, currency), currency).decimal,
  }));
}

/**
 * The Contributions drafts make, in the order they were added, or `null` while an amount
 * cannot be read (`parseMoney`). Built afresh, so they hold none of the form's reactive
 * proxies, which the device store cannot keep.
 */
export function contributionsFromDraft(
  drafts: readonly DraftContribution[],
  currency: string,
): Contribution[] | null {
  const contributions: Contribution[] = [];
  for (const { participantId, amount } of drafts) {
    const minor = parseMoney(amount, currency);
    if (minor === null) return null;
    contributions.push({ participantId, amount: minor });
  }
  return contributions;
}

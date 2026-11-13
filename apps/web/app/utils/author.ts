import type { Participant } from '@osi/owe-yeah-domain';

/**
 * Who made a change, as a sentence names them: this device's claimed Participant, another
 * Participant, or nobody the Trip knows.
 */
export type Author =
  | { is: 'you'; participant: Participant }
  | { is: 'named'; participant: Participant }
  | { is: 'nobody' };

/**
 * Who made a change, from its author's id (`by`, missing when not known), this device's Claim
 * and `everyone` the Trip has had, removed Participants included. "You" needs both a Claim
 * and a known author; an author the Trip doesn't know is nobody.
 */
export function whoMadeIt(
  by: string | null | undefined,
  claim: Participant | null,
  everyone: readonly Participant[],
): Author {
  const participant = by == null ? undefined : everyone.find(({ id }) => id === by);
  if (!participant) return { is: 'nobody' };
  return { is: claim?.id === participant.id ? 'you' : 'named', participant };
}

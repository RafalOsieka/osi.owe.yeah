import { splitParticipantIds, type Participant, type Split } from '@osi/owe-yeah-domain';
import type { DraftSplit } from '~/utils/receipt-draft';

/**
 * How a Line item's split reads in one line: its Split mode and who it names, with their
 * units for Units ("Units · Ania 2, Kasia 1"), "all N" when Even names everyone, or that
 * nobody has been given any of it yet.
 */
export function useSplitText() {
  const { t, locale } = useI18n();

  return (split: Split | DraftSplit, participants: readonly Participant[]): string => {
    const nameOf = (id: string) =>
      participants.find((participant) => participant.id === id)?.name ?? '?';
    const ids =
      split.mode === 'amounts'
        ? split.parts.flatMap(({ participantId, amount }) =>
            // A draft Amount left empty is nobody's yet.
            String(amount).trim() === '' ? [] : [participantId],
          )
        : splitParticipantIds(split);
    const mode = t(`receipt.mode.${split.mode}`);
    if (ids.length === 0) return `${mode} · ${t('receipt.nobodyYet')}`;
    if (split.mode === 'even' && ids.length === participants.length) {
      return `${mode} · ${t('expense.forAll', { count: ids.length })}`;
    }
    const names =
      split.mode === 'units'
        ? split.parts.map(({ participantId, units }) => `${nameOf(participantId)} ${units}`)
        : ids.map(nameOf);
    return `${mode} · ${new Intl.ListFormat(locale.value, { style: 'narrow' }).format(names)}`;
  };
}

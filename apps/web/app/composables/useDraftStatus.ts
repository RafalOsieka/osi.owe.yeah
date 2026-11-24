import type { ProtoDraft } from '~/prototype/photos-drafts';

// PROTOTYPE (#282): how a Draft's state reads in a list, in one place for every variant.
export function useDraftStatus() {
  const { claim } = useOpenTrip();
  const ago = (date: Date) => {
    const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  };
  return (draft: ProtoDraft) => {
    const by = `Scanned by ${draft.scannedBy === claim.value?.name ? 'you' : draft.scannedBy}, ${ago(draft.scannedAt)}`;
    switch (draft.state) {
      case 'upload':
        return {
          label: 'Waiting to upload',
          short: 'Waiting',
          icon: 'i-lucide-cloud',
          iconClass: '',
          tone: 'text-muted',
          by,
        };
      case 'reading':
        return {
          label: 'Being read…',
          short: 'Reading…',
          icon: 'i-lucide-loader-circle',
          iconClass: 'animate-spin',
          tone: 'text-muted',
          by,
        };
      case 'ready':
        return {
          label: 'Ready to check',
          short: 'Check',
          icon: 'i-lucide-receipt-text',
          iconClass: '',
          tone: 'text-primary',
          by,
        };
      case 'failed':
        return {
          label: "Couldn't read",
          short: "Couldn't read",
          icon: 'i-lucide-scan-eye',
          iconClass: '',
          tone: 'text-warning',
          by,
        };
      case 'refused':
        return {
          label: "Couldn't upload",
          short: "Couldn't upload",
          icon: 'i-lucide-circle-alert',
          iconClass: '',
          tone: 'text-warning',
          by,
        };
    }
  };
}

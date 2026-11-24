// PROTOTYPE (#282), throwaway: Photos and Drafts held in memory only, to judge how they look and
// behave on a phone. Nothing here syncs or persists; a reload starts again from the seed.
// A "read" always returns the sample receipt below, whatever picture was taken.
import { reactive } from 'vue';
import type { Participant } from '@osi/owe-yeah-domain';
import { draftLineItem, typedMoney, type DraftLineItem } from '~/utils/expense-draft';

export type PhotoState = 'uploaded' | 'queued' | 'refused';
export type ProtoPhoto = {
  id: string;
  url: string;
  addedBy: string;
  addedAt: Date;
  state: PhotoState;
  reason?: string;
};
export type DraftState = 'upload' | 'reading' | 'ready' | 'failed' | 'refused';
export type ProtoDraft = {
  id: string;
  photo: ProtoPhoto;
  scannedBy: string;
  scannedAt: Date;
  state: DraftState;
  reason?: string;
};

/** A doubt the reader has about one Line item, with where the line sits on the Photo. */
export type Doubt = { text: string; field: 'name' | 'price' | 'deposit'; y: number };

export const LIMITS = { perExpense: 3, perTrip: 10, drafts: 3 };

const state = reactive({
  online: true,
  failNext: false,
  tripFull: false,
  seeded: false,
  photos: {} as Record<string, ProtoPhoto[]>,
  drafts: [] as ProtoDraft[],
  /** A Photo carried from a Draft into a hand-typed Expense ("Type it by hand instead"). */
  carry: null as ProtoPhoto | null,
  variants: {} as Record<string, string>,
});

// The sample receipt: what it prints, and where each line sits on the 900 × 1600 picture.
const RECEIPT_LINES = [
  { name: 'MLEKO 2% 1L', qty: 2, price: 349, y: 470 },
  { name: 'CHLEB ZYTNI 500G', qty: 1, price: 599, y: 540 },
  { name: 'MASLO EXTRA 82%', qty: 1, price: 199, y: 610 },
  { name: 'WODA GAZ 1,5L', qty: 6, price: 209, y: 680 },
  { name: 'POMIDORY LUZ 0,852KG', qty: 1, price: 849, y: 750 },
  { name: 'SER GOUDA PLAST.', qty: 1, price: 679, y: 820 },
];
export const RECEIPT_SIZE = { width: 900, height: 1600 };
/** What was paid: the printed SUMA (goods) plus the Deposits printed under it (6 × 0,50 zł). */
export const PRINTED_TOTAL = 4578;

const pln = (minor: number) => (minor / 100).toFixed(2).replace('.', ',');

/** A fake phone shot of a paper receipt, as an SVG data URL. */
export function receiptPicture({
  blurry = false,
  tint = '#3b3a36',
}: { blurry?: boolean; tint?: string } = {}): string {
  const rows = RECEIPT_LINES.map(
    ({ name, qty, price, y }) =>
      `<text x="150" y="${y}">${name}</text><text x="150" y="${y + 30}" class="s">${qty} x ${pln(price)}</text><text x="750" y="${y + 30}" text-anchor="end" ${
        name.startsWith('MASLO') ? 'opacity=".45"' : ''
      }>${pln(qty * price)} C</text>`,
  ).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 1600">
  <defs><filter id="b"><feGaussianBlur stdDeviation="${blurry ? 9 : 0.6}"/></filter>
  <linearGradient id="l" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".0"/><stop offset="1" stop-color="#000" stop-opacity=".12"/></linearGradient></defs>
  <rect width="900" height="1600" fill="${tint}"/>
  <g filter="url(#b)" transform="rotate(-1.2 450 800)">
  <path d="M110 120 L790 110 L800 1490 L120 1500 Z" fill="#f6f3ea"/>
  <g font-family="monospace" font-size="30" fill="#2a2a2a">
  <text x="450" y="210" text-anchor="middle" font-size="40" font-weight="bold">SKLEP SPOZYWCZY</text>
  <text x="450" y="260" text-anchor="middle">ul. Przykladowa 1, 00-000 Miasto</text>
  <text x="450" y="300" text-anchor="middle">NIP 000-000-00-00</text>
  <text x="150" y="380">2026-11-12 18:42</text><text x="750" y="380" text-anchor="end">nr 4821</text>
  <text x="450" y="430" text-anchor="middle" font-weight="bold">PARAGON FISKALNY</text>
  <style>.s{font-size:26px;fill:#555}</style>
  ${rows}
  <text x="150" y="920">--------------------------------</text>
  <text x="150" y="980" font-size="40" font-weight="bold">SUMA PLN</text><text x="750" y="980" text-anchor="end" font-size="40" font-weight="bold">${pln(PRINTED_TOTAL - 300)}</text>
  <text x="150" y="1060">KAUCJA BUTELKI 6 x 0,50</text><text x="750" y="1060" text-anchor="end">3,00</text>
  <text x="150" y="1130">KARTA PLATNICZA</text><text x="750" y="1130" text-anchor="end">${pln(PRINTED_TOTAL)}</text>
  <text x="450" y="1260" text-anchor="middle">DZIEKUJEMY ZA ZAKUPY</text>
  </g><rect x="110" y="110" width="690" height="1390" fill="url(#l)"/></g></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** The sample receipt's picture, for the crops of doubtful lines. */
export const SAMPLE_PICTURE = receiptPicture();

/** What the reader makes of the sample receipt: its Line items, and its doubts by line key. */
export function readReceipt(participants: readonly Participant[]): {
  lineItems: DraftLineItem[];
  doubts: Record<string, Doubt>;
  /** Where each line sits on the picture (its y), by line key. */
  positions: Record<string, number>;
} {
  const everyone = participants.map(({ id }) => id);
  const doubts: Record<string, Doubt> = {};
  const positions: Record<string, number> = {};
  const lineItems = RECEIPT_LINES.map(({ name, qty, price, y }) => {
    const pretty = name.charAt(0) + name.slice(1).toLowerCase();
    const line = draftLineItem({
      name: pretty,
      // The smudged Masło is read wrongly as 7,99.
      price: typedMoney(name.startsWith('MASLO') ? 799 : price, 'PLN'),
      quantity: qty,
      split: { mode: 'even', participantIds: [...everyone] },
      deposit: name.startsWith('WODA') ? typedMoney(50, 'PLN') : '',
    });
    positions[line.key] = y;
    if (name.startsWith('MASLO'))
      doubts[line.key] = { text: 'Price hard to read: 7,99 or 1,99?', field: 'price', y };
    if (name.startsWith('WODA'))
      doubts[line.key] = {
        text: 'Deposit printed under the total. Is it for this line?',
        field: 'deposit',
        y,
      };
    if (name.startsWith('SER')) doubts[line.key] = { text: 'Name hard to read', field: 'name', y };
    return line;
  });
  return { lineItems, doubts, positions };
}

// For the screenshot script: picks a screen's variant from outside.
if (typeof window !== 'undefined')
  Object.assign(window, {
    protoVariant: (screen: string, key: string) => (state.variants[screen] = key),
  });

let counter = 0;
const nextId = () => `proto-${Date.now()}-${counter++}`;

function photo(url: string, addedBy: string, minutesAgo: number, state: PhotoState = 'uploaded') {
  return {
    id: nextId(),
    url,
    addedBy,
    addedAt: new Date(Date.now() - minutesAgo * 60_000),
    state,
  } satisfies ProtoPhoto;
}

/** The prototype's state and actions, seeded once per page load from the open Trip. */
export function usePrototype() {
  const { trip, claim } = useOpenTrip();
  const route = useRoute();
  const you = () => claim.value?.name ?? 'you';
  // Someone else in the Trip: the second Participant, or the first if you are the second.
  const other = () => {
    const [first, second] = trip.value.participants;
    return (second && second.id !== claim.value?.id ? second : first)?.name ?? 'Ania';
  };

  if (!state.seeded) {
    state.seeded = true;
    const newest = trip.value.expenses.at(-1);
    if (newest)
      state.photos[newest.id] = [
        photo(receiptPicture({ tint: '#5a4a3a' }), other(), 60 * 26),
        photo(receiptPicture({ tint: '#2f3b44' }), you(), 3, 'queued'),
      ];
    state.drafts = [
      { ...draft(other(), 60 * 20), state: 'ready' },
      { ...draft(you(), 2), state: 'reading' },
      { ...draft(you(), 60 * 3, true), state: 'failed' },
    ];
  }

  function draft(by: string, minutesAgo: number, blurry = false): ProtoDraft {
    const shot = photo(receiptPicture({ blurry }), by, minutesAgo);
    return { id: nextId(), photo: shot, scannedBy: by, scannedAt: shot.addedAt, state: 'upload' };
  }

  /** How many Photos the Trip holds, Drafts' included, as the limit counts them. */
  const tripPhotos = () =>
    state.tripFull
      ? LIMITS.perTrip
      : Object.values(state.photos).flat().length + state.drafts.length;

  // A Draft that is uploaded joins the queue and is read a few seconds later.
  function read(target: ProtoDraft): void {
    target.state = 'reading';
    const fail = state.failNext;
    state.failNext = false;
    setTimeout(() => {
      if (target.state === 'reading') target.state = fail ? 'failed' : 'ready';
    }, 6000);
  }

  return {
    state,
    you,
    other,
    tripPhotos,
    /** Scan a Receipt: a Draft at once, uploaded and read once online. */
    scan(url: string): ProtoDraft {
      const shot = photo(url, you(), 0, state.online ? 'uploaded' : 'queued');
      const made = reactive<ProtoDraft>({
        id: nextId(),
        photo: shot,
        scannedBy: you(),
        scannedAt: new Date(),
        state: 'upload',
      });
      state.drafts.unshift(made);
      if (state.online) read(made);
      return made;
    },
    newPhoto(url: string): ProtoPhoto {
      return photo(url, you(), 0, 'queued');
    },
    /** Going online uploads what waits and reads the Drafts it uploads. */
    setOnline(online: boolean): void {
      state.online = online;
      if (!online) return;
      for (const waiting of state.drafts.filter(({ state }) => state === 'upload')) read(waiting);
      for (const list of Object.values(state.photos))
        for (const queued of list.filter(({ state }) => state === 'queued'))
          queued.state = 'uploaded';
    },
    readAllNow(): void {
      for (const waiting of state.drafts.filter(({ state }) => state !== 'refused'))
        if (waiting.state === 'reading' || waiting.state === 'upload') waiting.state = 'ready';
    },
    /** Marks the newest Draft and the newest queued Photo refused, as if the Trip filled up. */
    refuseSome(): void {
      const draftToRefuse = state.drafts.find(
        ({ state }) => state === 'upload' || state === 'reading',
      );
      if (draftToRefuse) {
        draftToRefuse.state = 'refused';
        draftToRefuse.reason = `The Trip already has ${LIMITS.perTrip} Photos.`;
      }
      for (const list of Object.values(state.photos))
        for (const queued of list.filter(({ state }) => state === 'queued')) {
          queued.state = 'refused';
          queued.reason = `The Trip already has ${LIMITS.perTrip} Photos.`;
        }
    },
    retry(target: ProtoDraft | ProtoPhoto): void {
      target.reason = undefined;
      if ('scannedBy' in target) {
        target.state = 'upload';
        if (state.online) read(target);
      } else target.state = state.online ? 'uploaded' : 'queued';
    },
    discard(id: string): void {
      state.drafts = state.drafts.filter((draft) => draft.id !== id);
    },
    reset(): void {
      state.seeded = false;
      state.photos = {};
      state.drafts = [];
      location.reload();
    },
    /** The variant picked for one screen, from `?variant=` or the switcher, sticky per screen. */
    variant(screen: string): string {
      const fromUrl = typeof route.query.variant === 'string' ? route.query.variant : null;
      if (fromUrl && route.query.screen === screen) state.variants[screen] = fromUrl;
      return state.variants[screen] ?? 'A';
    },
    // Not in the address: a route change would ask a changed form to discard first.
    setVariant(screen: string, key: string): void {
      state.variants[screen] = key;
    },
  };
}

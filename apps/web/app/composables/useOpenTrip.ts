import type { Expense, Participant, PushProblem, TripSnapshot } from '@osi/owe-yeah-domain';
import type { InjectionKey } from 'vue';

/**
 * Why saving an Expense was refused: a rule the server enforces, a Conflict with someone
 * else's change, or `unsent` when no answer came back (e.g. no signal).
 */
export type SaveRefusal = PushProblem | 'conflict' | 'unsent';

/**
 * The Trip open on screen, as `pages/trips/[id].vue` loads it once for its pages and for
 * the Trip layout.
 */
export interface OpenTrip {
  /** The whole Trip as last pulled. */
  trip: Readonly<Ref<TripSnapshot>>;
  /** The Participant this device says it is in the Trip, if it has said. */
  claim: Readonly<Ref<Participant | null>>;
  /** Lets a request into the Trip: the Trip link's token kept on this device (ADR 0001). */
  headers: Readonly<Record<string, string>>;
  /** Pulls the Trip again. */
  refresh(): Promise<void>;
  /**
   * Adds a Participant and pulls the Trip again; `false` when it could not be sent. Keep
   * the same id for a retry, so a lost response doesn't add them twice.
   */
  addParticipant(participant: Participant): Promise<boolean>;
  /**
   * Sends an Expense's full new state, based on the version the user edited (`null` for a
   * new Expense), and pulls the Trip again. Resolves to why it was refused, empty when it
   * was saved. A resend of the very same change keeps its id, so it is not applied twice.
   */
  saveExpense(expense: Expense, baseVersion: number | null): Promise<SaveRefusal[]>;
  /** Opens the "Who are you?" sheet. */
  askWhoYouAre(): void;
}

const openTripKey: InjectionKey<OpenTrip> = Symbol('open-trip');

export function provideOpenTrip(openTrip: OpenTrip): void {
  provide(openTripKey, openTrip);
}

/** The open Trip, from anywhere under `pages/trips/[id].vue`. */
export function useOpenTrip(): OpenTrip {
  const openTrip = inject(openTripKey);
  if (!openTrip) throw new Error('useOpenTrip() is only available inside an open Trip');
  return openTrip;
}

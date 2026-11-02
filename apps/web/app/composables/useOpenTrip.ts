import type {
  Currency,
  Expense,
  ExpenseProblem,
  Participant,
  Revision,
  Trip,
} from '@osi/owe-yeah-domain';
import type { InjectionKey } from 'vue';
import type { ExpenseBase, Notice } from '~/sync/db';
import type { LocalTrip } from '~/sync/local-trip';

/**
 * The Trip open on screen, as `pages/trips/[id].vue` reads it from the device for its pages
 * and for the Trip layout. Every change is saved on the device first and synced later
 * (ADR 0002), so none of them waits for the network.
 */
export interface OpenTrip {
  /** The Trip as this device shows it, its changes not synced yet included. */
  trip: Readonly<Ref<LocalTrip>>;
  /** The Participant this device says it is in the Trip, if it has said. */
  claim: Readonly<Ref<Participant | null>>;
  /** The currency of the Expense last saved on this device, which a new one starts in. */
  lastCurrency: Readonly<Ref<Currency | null>>;
  /** How many of this device's changes to the Trip the server has not accepted yet. */
  unsynced: Readonly<Ref<number>>;
  /**
   * Every Participant the Trip has had, removed ones included: to name them on older
   * versions and deleted Expenses. New Expenses only pick from `trip.participants`.
   */
  everyone: Readonly<Ref<Participant[]>>;
  /** What sync has to tell about this device's changes, until dismissed. */
  notices: Readonly<Ref<Notice[]>>;
  dismissNotice(noticeId: string): Promise<void>;
  /** Syncs the Trip now, e.g. on pull-to-refresh. */
  sync(): Promise<void>;
  /** Adds a Participant on the device. */
  addParticipant(participant: Participant): Promise<void>;
  /**
   * Removes a Participant softly on the device, unless an Expense references them. Resolves
   * to how many do: 0 when they were removed.
   */
  removeParticipant(participant: Participant): Promise<number>;
  /**
   * Saves the Trip's name and Trip currency on the device, last write wins; a new Trip
   * currency rewrites no Expense.
   */
  saveTripDetails(details: Omit<Trip, 'id'>): Promise<void>;
  /** Forgets the Trip on this device, losing changes not synced yet, and opens My Trips. */
  forget(): Promise<void>;
  /**
   * Saves an Expense's full new state on the device, based on the Expense the user edited
   * (its `base`; `{ version: null }` for a new one). Resolves to the Trip rules it breaks,
   * empty when it was saved. Saving a deleted Expense, or an older Revision, restores it.
   */
  saveExpense(expense: Expense, base: ExpenseBase): Promise<ExpenseProblem[]>;
  /** Deletes an Expense on the device, to Recently deleted; otherwise like `saveExpense`. */
  deleteExpense(expense: Expense, base: ExpenseBase): Promise<ExpenseProblem[]>;
  /** An Expense's Revisions from the server, newest first. Rejects without a connection. */
  revisions(expenseId: string): Promise<Revision[]>;
  /** Resolves an Expense's Conflict with this device's version, sending it again. */
  keepMine(expenseId: string): Promise<void>;
  /**
   * Drops this device's changes of an Expense not synced yet: keeps theirs in a Conflict, or
   * discards a rejected change.
   */
  discardChanges(expenseId: string): Promise<void>;
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

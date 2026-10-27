# Own sync: server-authoritative, whole-Expense conflicts, whole-Trip pull

Owe Yeah syncs offline changes with its own small protocol on top of Postgres, not with a sync service or CRDTs. Each device keeps whole Trips locally and queues changes in an outbox. A change carries the full new state of one Expense plus the version it was based on. The server validates the change with the same domain code the client uses, and accepts it only if the base version still matches. Otherwise it is a Conflict, and the Participant who synced second chooses whose version to keep. Pulling returns the whole Trip whenever its version has changed.

We chose this over PowerSync (an extra service plus SQLite-WASM in the browser, only to save read-sync on a few hundred Expenses per Trip), Dexie Cloud (its own auth clashes with ADR 0001, the server is closed source, and it ties us to a vendor) and CRDTs or field-level last-write-wins (they can merge two money edits into a state nobody meant).

## Consequences

- Ids are client-generated, so Trips, Participants and Expenses can be created offline. Every change has its own id, so retries are idempotent.
- The whole Expense (Line items, Contributions, Deposits, discounts) is the unit of conflict. Different Expenses never conflict. Deletes are soft and versioned like edits.
- Trip details and Participants are last-write-wins per record. Removing a Participant is soft, and an accepted Expense that references them restores them.
- A Conflict or a rule rejection holds back only its own Expense. Pending local changes are always shown on top of the pulled Trip.
- Whole-Trip pull means no change feed, checkpoints or tombstone sync. If Trips ever grow large, incremental pull is the escape hatch.
- The server accepts only the newest schema. Older clients get "update needed", migrate their local data and queued changes through a chain of client-side migrations, and resend. That chain has to be kept and tested.
- Sync is push/pull only (on app open, focus, a local change, reconnect, and periodically while visible). There are no live connections to host.

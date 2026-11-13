# Roadmap

Ideas Owe Yeah may pursue after the MVP: everything a spec, a map or its tickets postponed, with the constraints already decided and where they were decided. Nothing here is committed or ordered. Picking an idea up means charting it as a map or writing a spec in [GitHub Issues](https://github.com/RafalOsieka/osi.owe.yeah/issues), as usual; the linked tickets hold the decisions, this file only points at them.

When a map or spec postpones something, add it here. When one picks an idea up, move it to [On hold or in progress](#on-hold-or-in-progress), and drop it once it ships.

## On hold or in progress

- **Photos on Expenses and Receipt scanning** ([#274](https://github.com/RafalOsieka/osi.owe.yeah/issues/274), on hold since 2026-11-13): attach pictures to an Expense, then turn a photo of a Receipt into Line items to check and save. Its open tickets are [#278](https://github.com/RafalOsieka/osi.owe.yeah/issues/278) to [#285](https://github.com/RafalOsieka/osi.owe.yeah/issues/285), and its glossary entries (Photo, Draft) wait on the `docs/glossary-photo-draft` branch. Still unspecified on the map: the scan flow on the phone, abuse on the public instance, and rate limits for scanning.

## Trips and Participants

- **Merging duplicate Participants** (two offline phones each add "Kasia"). Workaround today: move the Expenses by hand, then remove the empty duplicate. [#5](https://github.com/RafalOsieka/osi.owe.yeah/issues/5), [#17](https://github.com/RafalOsieka/osi.owe.yeah/issues/17)
- **Regenerating a Trip link** (revocation). The token is independent of the Trip id, so it needs no migration ([ADR 0001](docs/adr/0001-trip-link-is-the-credential.md)). [#5](https://github.com/RafalOsieka/osi.owe.yeah/issues/5), [#17](https://github.com/RafalOsieka/osi.owe.yeah/issues/17)
- **Archiving a Trip**: read-only, reversible by anyone; queued edits get a rule rejection ("not synced: Trip archived"). [#16](https://github.com/RafalOsieka/osi.owe.yeah/issues/16), [#17](https://github.com/RafalOsieka/osi.owe.yeah/issues/17)
- **Deleting a Trip for everyone**, alongside archiving. Until then the operator does it by hand ([`erase.sql`](deploy/osieka-dev/requests/erase.sql)). Also needed before prod, see [Going public and prod](#going-public-and-prod). [#17](https://github.com/RafalOsieka/osi.owe.yeah/issues/17), [#98](https://github.com/RafalOsieka/osi.owe.yeah/issues/98)
- **Payment details on a Participant** (IBAN, BLIK phone, Revtag). No glossary term yet. [#17](https://github.com/RafalOsieka/osi.owe.yeah/issues/17)

## Expenses and the Expense list

- **Shares Split mode** (free weights, e.g. 2:1 for a couple). The weights engine supports it at no cost. [#2](https://github.com/RafalOsieka/osi.owe.yeah/issues/2), [#19](https://github.com/RafalOsieka/osi.owe.yeah/issues/19)
- **Categories** and per-category stats. [#17](https://github.com/RafalOsieka/osi.owe.yeah/issues/17)
- **Search and filters** on the Expense list (by payer, by Participant, by currency). [#17](https://github.com/RafalOsieka/osi.owe.yeah/issues/17)
- **"Same again"**: copy an Expense as a new one. [#17](https://github.com/RafalOsieka/osi.owe.yeah/issues/17)
- **Export** (CSV/JSON). Losing Tricount's export was one of the reasons for Owe Yeah ([#19](https://github.com/RafalOsieka/osi.owe.yeah/issues/19)); today only the operator can export a Trip ([`export.sql`](deploy/osieka-dev/requests/export.sql)). [#17](https://github.com/RafalOsieka/osi.owe.yeah/issues/17)
- **Trip-wide activity feed** ("what changed since I last looked"): a query across Revisions plus a per-device "last seen". [#16](https://github.com/RafalOsieka/osi.owe.yeah/issues/16), [#17](https://github.com/RafalOsieka/osi.owe.yeah/issues/17)

## Receipts, after scanning

- **Printed total** with a "matches / off by X" check: an optional field that never affects balances, meant to come with Receipt scanning. [#14](https://github.com/RafalOsieka/osi.owe.yeah/issues/14)
- **Line item translation** on demand: a separate effort after scanning. A printed-text ("as printed") field on a Line item returns only together with it. [#14](https://github.com/RafalOsieka/osi.owe.yeah/issues/14), [#274](https://github.com/RafalOsieka/osi.owe.yeah/issues/274)
- **Training on corrected Drafts** to improve the reader: needs consent. [#274](https://github.com/RafalOsieka/osi.owe.yeah/issues/274)

## Sync

- **Incremental pull** for large Trips. The app pulls the whole Trip; Expense versions keep the protocol open for it ([ADR 0002](docs/adr/0002-own-sync-whole-expense-conflicts.md)). [#17](https://github.com/RafalOsieka/osi.owe.yeah/issues/17)
- **Live updates** (websockets/SSE). Today the app syncs on open and focus, after a change, on reconnect, every ~30 s while visible and on pull-to-refresh. [#17](https://github.com/RafalOsieka/osi.owe.yeah/issues/17)
- **A client timeout on sync requests**: optional, not needed for correctness. [#95](https://github.com/RafalOsieka/osi.owe.yeah/issues/95), [#98](https://github.com/RafalOsieka/osi.owe.yeah/issues/98)

## Platform

- **Native wrappers** (TWA for Android, Capacitor or similar for iOS), once the PWA has proven itself. [#1](https://github.com/RafalOsieka/osi.owe.yeah/issues/1), [#19](https://github.com/RafalOsieka/osi.owe.yeah/issues/19)

## Going public and prod

The MVP optimises for our own group, and public-phase hosting was left past its destination ([#1](https://github.com/RafalOsieka/osi.owe.yeah/issues/1)). The test environment work ([#88](https://github.com/RafalOsieka/osi.owe.yeah/issues/88), [#98](https://github.com/RafalOsieka/osi.owe.yeah/issues/98)) and its legal research ([#93](https://github.com/RafalOsieka/osi.owe.yeah/issues/93), [#94](https://github.com/RafalOsieka/osi.owe.yeah/issues/94)) named what prod needs on top of test:

- **Accounts**: a product effort of its own, planned before prod. Accounts would hold Trip links and Claims rather than replace them ([ADR 0001](docs/adr/0001-trip-link-is-the-credential.md)). [#5](https://github.com/RafalOsieka/osi.owe.yeah/issues/5), [#88](https://github.com/RafalOsieka/osi.owe.yeah/issues/88), [#98](https://github.com/RafalOsieka/osi.owe.yeah/issues/98)
- **Data retention with automatic deletion**, and a real server-side Trip delete. Purging Revisions and deleted Expenses, which are kept forever today, belongs here too. [#16](https://github.com/RafalOsieka/osi.owe.yeah/issues/16), [#88](https://github.com/RafalOsieka/osi.owe.yeah/issues/88), [#93](https://github.com/RafalOsieka/osi.owe.yeah/issues/93), [#98](https://github.com/RafalOsieka/osi.owe.yeah/issues/98)
- **Legal review**: a lawyer's review, or else a second pass against official guidance, deciding explicitly the service worker under PKE art. 399 ust. 4, the GPL-2.0 source offer for the Alpine layer, the legal basis, and push services as recipients; plus updates for accounts. [#88](https://github.com/RafalOsieka/osi.owe.yeah/issues/88), [#93](https://github.com/RafalOsieka/osi.owe.yeah/issues/93), [#94](https://github.com/RafalOsieka/osi.owe.yeah/issues/94)
- **Abuse control and monetisation** of a public instance. [#1](https://github.com/RafalOsieka/osi.owe.yeah/issues/1), [#19](https://github.com/RafalOsieka/osi.owe.yeah/issues/19)
- **Standing up staging and prod**: a second file on `deploy` changed only by a manual workflow behind a GitHub Environment with required reviewers ([ADR 0005](docs/adr/0005-environments-pull-digest-pinned-images-from-git.md)), protected data, and the cut-over to the reserved prod hostname. [#88](https://github.com/RafalOsieka/osi.owe.yeah/issues/88)
- **Zero-downtime and safe-failure deploys**: Compose stops the old app before the migrator runs, so a failed migration leaves the app down (accepted for test only). [#88](https://github.com/RafalOsieka/osi.owe.yeah/issues/88), [#91](https://github.com/RafalOsieka/osi.owe.yeah/issues/91), [#98](https://github.com/RafalOsieka/osi.owe.yeah/issues/98)
- **Prod backups**. [#88](https://github.com/RafalOsieka/osi.owe.yeah/issues/88), [#98](https://github.com/RafalOsieka/osi.owe.yeah/issues/98)
- **An uptime monitor** for prod; test relies on Cloudflare's tunnel health emails. [#96](https://github.com/RafalOsieka/osi.owe.yeah/issues/96)
- **An observability stack** (e.g. Grafana) for logs and metrics. [#88](https://github.com/RafalOsieka/osi.owe.yeah/issues/88), [#98](https://github.com/RafalOsieka/osi.owe.yeah/issues/98)
- **PR preview environments**. [#88](https://github.com/RafalOsieka/osi.owe.yeah/issues/88), [#98](https://github.com/RafalOsieka/osi.owe.yeah/issues/98)

## Engineering

- **The Receipt discount's spread is walked three times in the domain** (the total, the shares, the breakdown). Revisit only if a new kind of part makes a third edit site hurt. [#251](https://github.com/RafalOsieka/osi.owe.yeah/issues/251)
- **Coverage reporting** (Codecov): left out "for now" when the tooling was copied from `osi.time.tracker`. [#13](https://github.com/RafalOsieka/osi.owe.yeah/issues/13)

## Ruled out

Not postponed: decided against, and listed so they aren't raised again without a new reason.

- Trip-level default rates ([#9](https://github.com/RafalOsieka/osi.owe.yeah/issues/9)), an in-app Tricount import ([#12](https://github.com/RafalOsieka/osi.owe.yeah/issues/12)), a pairwise "who owes whom" view, recurring Expenses and in-app payments ([#17](https://github.com/RafalOsieka/osi.owe.yeah/issues/17)).
- Storing printed Line item text and a generic negative Line item ([#14](https://github.com/RafalOsieka/osi.owe.yeah/issues/14)), and locking Expenses ([#16](https://github.com/RafalOsieka/osi.owe.yeah/issues/16)).
- Non-picture files (PDF e-receipts, invoices) and LLM-based reading of receipts ([#274](https://github.com/RafalOsieka/osi.owe.yeah/issues/274)).
- Hosting fully on Cloudflare, Cloudflare Access in front of test, and rollback tooling: fix forward, or revert the latest `deploy` commit ([#88](https://github.com/RafalOsieka/osi.owe.yeah/issues/88), [#98](https://github.com/RafalOsieka/osi.owe.yeah/issues/98)).

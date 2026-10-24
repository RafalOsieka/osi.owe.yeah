# Research: offline-first sync approaches for a Nuxt PWA

Resolves research ticket [Which offline-first sync approaches fit a Nuxt PWA?](https://github.com/RafalOsieka/osi.owe.yeah/issues/6) on the map [Map: Owe Yeah MVP spec and tech stack](https://github.com/RafalOsieka/osi.owe.yeah/issues/1). It feeds the grilling ticket that picks the approach; it does **not** make the decision.

State of the world as of **October 2026**. Prices and statuses move fast; re-check before committing.

## What Owe Yeah actually needs from sync

These traits narrow the field more than any feature list:

- **Offline writes are non-negotiable.** Several Participants record Expenses on the same Trip without signal, for hours or days, and sync later. Read-only offline (cached data) is not enough.
- **Small data, clean partitions.** A Trip is hundreds of Expenses, maybe low thousands of Line items. Each device only needs the Trips it belongs to. No partial-sync heroics needed.
- **Mostly append, rarely the same record.** Most concurrent work is two people adding *different* Expenses. True conflicts (two people editing the same Expense) are rare but must not silently corrupt money.
- **Field-level merging is dangerous for money.** If Ana changes an Expense amount while Ben changes its split, a field-level last-write-wins (or a CRDT) happily produces a combination neither of them meant. Record-level (per Expense / per Receipt) conflict handling, or a server that validates the merged result, fits better than "everything merges automatically".
- **Balances are derived.** Who owes whom is computed from Expenses, so it can be recomputed locally after every sync; it does not need its own sync.
- **Sharing is per Trip.** Tricount-style "join via link" plus later real accounts when going public. Whatever we pick must support per-Trip access control on the server.
- **Small group now, public later.** Free/cheap and self-hostable now; no licence or architecture trap when going public.

### Platform caveat that applies to every option

Browser storage on iOS is the real offline risk, not the sync library. Safari evicts script-writable storage (IndexedDB, OPFS) of sites that are not used for a while unless the PWA is added to the Home Screen; any browser may evict under storage pressure. Mitigations: ask users to install the PWA, call `navigator.storage.persist()`, and sync eagerly whenever online so the server copy is never far behind. Unsynced local writes are the only thing truly at risk.

## Options

### 1. Custom: local IndexedDB store + outbox + own sync API

Local store (Dexie.js or plain IndexedDB; optionally TanStack DB with `@tanstack/offline-transactions` as the outbox) plus a small sync API in the Nuxt server (Nitro) on top of Postgres or SQLite.

- **Conflict handling:** whatever we design. The natural fit: clients queue *domain operations* (`addExpense`, `editExpense`, `deleteExpense`) with client-generated ids and an idempotency key; the server applies them in order, checks a per-record version and either accepts, rejects, or records a conflict for a Participant to resolve. Pull is "changes since checkpoint, per Trip".
- **Backend:** anything. Postgres or SQLite behind Nitro.
- **Self-hosting:** trivially; it is our code in our Docker image.
- **Cost:** €0 licences; only hosting. The cost is engineering time: outbox, retries, checkpoints, tombstones, schema migrations of local data, multi-tab coordination.
- **Maturity:** Dexie.js is mature and actively maintained (commits this week). `@tanstack/offline-transactions` is 1.x, gives a durable IndexedDB outbox with retries, leader-tab election and idempotency keys, and TanStack DB has Vue bindings.
- **Vue/Nuxt fit:** good. Dexie `liveQuery` wraps into a composable easily; TanStack DB has an official Vue adapter.
- **Lock-in / exit cost:** none. The protocol is ours.
- **Risk:** we own every sync bug. For our data shape (small, partitioned, mostly append) this is a well-understood problem, not research.

### 2. Dexie Cloud

Hosted (or on-prem) sync server for Dexie.js, with auth, access control and invites built in.

- **Conflict handling:** server-authoritative "consistent operations": `where(...).modify()` / `delete()` expressions are replayed on the server at sync time, so operations rather than snapshots are merged. Transactions are atomic in the cloud. Y.js integration for CRDT text. Effectively per-operation, server-ordered.
- **Backend:** Dexie Cloud server (its own storage). Not your Postgres. Integrates with your backend via REST API and webhooks.
- **Self-hosting:** only by paying for on-prem: €3,495 one-off (Docker image, 5 years of updates) or €7,995 with full source. The server is closed source otherwise.
- **Cost:** free plan with limited production users (plus unlimited evaluation users); hosted production plans are per seat, cheap at our scale.
- **Maturity:** Dexie.js is a long-lived, very active project; Dexie Cloud has been in production for years, run by a small company (Awarica AB).
- **Vue/Nuxt fit:** good; framework-agnostic `liveQuery`, Vue examples exist.
- **Batteries:** realms / roles / members map almost one-to-one onto Trip / Participant sharing, with built-in invitation emails and passwordless login.
- **Lock-in / exit cost:** medium-high. Local data stays plain IndexedDB, but sync, auth, sharing and the server-side store are all theirs; leaving means rebuilding the backend. Server-side analytics or features need export via REST.

### 3. RxDB

Reactive NoSQL client database with pluggable storage and replication plugins.

- **Conflict handling:** explicit conflict handler on the client (`isEqual` + `resolve`; default "server wins"); the push endpoint returns the conflicting server documents. Optional CRDT plugin. Incremental operations (`incrementalModify`) avoid local conflicts.
- **Backend:** bring your own. HTTP replication with pull/push handlers against any API (Postgres REST endpoint, GraphQL, CouchDB, Supabase, etc.).
- **Self-hosting:** yes, it is a client library.
- **Cost:** core Apache-2.0; faster production storages (IndexedDB/OPFS, encryption, some server adapters) are paid Pro / Pro Plus licences. The free core runs on the Dexie-based storage.
- **Maturity:** mature, very active (commits today), single main maintainer (Daniel Meyer).
- **Vue/Nuxt fit:** fine via observables / signals; no official Nuxt module.
- **Lock-in / exit cost:** low-medium. Replication protocol is simple and documented; we still write the server side. Premium plugins are a licence dependency, not an architecture one.
- **Note:** RxDB is essentially "option 1 with a framework around it". It buys a replication protocol and conflict hooks, at the cost of a heavier client and a document (Mango query) model.

### 4. PowerSync

Sync service that replicates from a backend database into client-side SQLite (WASM in the browser); writes go through an upload queue to **your** API.

- **Conflict handling:** server-authoritative reconciliation. Client mutations land in an ordered upload queue, drained sequentially against our backend endpoints; our backend decides (default per-field LWW, deletes win; customisable). Changes flow back via replication. This fits "server validates the Expense" well.
- **Backend:** Postgres, MongoDB, MySQL, SQL Server (Azure DocumentDB too). Plus our own write API.
- **Self-hosting:** yes, **Open Edition** (free, source-available under the Functional Source License; client SDKs are Apache-2.0). Self-hosting means running the PowerSync Service container plus its bucket storage (Postgres or MongoDB).
- **Cost:** self-hosted free. Cloud free tier (2 GB synced/month, 50 peak concurrent clients, deactivates when idle), Pro from $49/month.
- **Maturity:** commercial company, production customers, very active (Jan 2026 added SQL Server; client commits this week).
- **Vue/Nuxt fit:** best of the field: `@powersync/vue` composables and a first-class `@powersync/nuxt` module (announced March 2026, alpha) with Devtools diagnostics and optional Kysely for typed queries.
- **Lock-in / exit cost:** medium-low. Data lives in our Postgres; writes go through our API. Leaving means replacing the read-sync path and the client SQLite layer, not the backend. The FSL converts each release to a permissive open-source licence after two years and mainly restricts offering a competing commercial service.
- **Cost of the box:** SQLite-WASM in the browser (bundle size, OPFS/IndexedDB VFS quirks on Safari) and one more service to run.

### 5. ElectricSQL (+ TanStack DB / PGlite)

Postgres read-path sync engine ("shapes" over HTTP/CDN). Writes are your own API.

- **Conflict handling:** none built in for writes. You write through your API; TanStack DB optimistic mutations plus `@tanstack/offline-transactions` give an offline outbox. Fully offline "through-the-database" writes need PGlite (WASM Postgres) and custom shadow-table/changelog sync.
- **Backend:** Postgres (logical replication) required.
- **Self-hosting:** yes, Apache-2.0, an Elixir service next to Postgres.
- **Cost:** self-hosted free. **Electric Cloud is winding down**: Electric was acquired by Databricks (joined Neon) in August 2026; open-source projects stay open, cloud users must self-host or move.
- **Maturity:** sync engine 1.x is solid, but the company's focus is now Lakebase / agents inside Databricks. Long-term direction for independent users is uncertain.
- **Vue/Nuxt fit:** via TanStack DB's Vue adapter.
- **Lock-in / exit cost:** low (it is Postgres + your API), but offline writes are mostly DIY, so it saves less work than it seems.

### 6. Replicache / Zero (Rocicorp)

- **Replicache:** client-side sync with server reconciliation (replayed mutators, "multiplayer games" style), works offline for hours/days, any backend. **In maintenance mode**: open-sourced, free, supported but no new features; Rocicorp tells users to migrate to Zero. Since a later release, per-tab storage means tabs do not sync with each other while offline.
- **Zero:** reached 1.0 in June 2026; Postgres + `zero-cache`; excellent server-reconciled mutators. **Does not support offline writes**: writes are rejected once disconnected (queued only during the brief "connecting" state). Deliberate design choice. Vue bindings are community-maintained.
- **Verdict:** Zero is a dealbreaker for our core requirement. Replicache's model fits us conceptually but building on a maintenance-mode library for a product meant to go public is a poor bet.

### 7. CRDT documents: Automerge / Yjs

- **Conflict handling:** automatic convergence; every field merges. Great for text, risky for money (see "field-level merging" above). We would need to layer validation and "conflict view" on top.
- **Backend:** a document sync relay (`automerge-repo` sync server, Subduction; Yjs via y-websocket / Hocuspocus). Server-side querying (for a future public product: search, admin, exports) means materialising docs into a database ourselves.
- **Self-hosting:** yes, MIT, all open source.
- **Cost:** free.
- **Maturity:** both active. Automerge 3 cut memory by 10x+; automerge-repo 2.x, new Subduction sync and Keyhive access control still work in progress. Yjs is mature and widely used, mostly for editors.
- **Vue/Nuxt fit:** no first-class Vue bindings for automerge-repo (React/Svelte/Solid); Yjs is framework-agnostic, wrapping is easy.
- **Lock-in / exit cost:** medium. Data is in a CRDT binary format; access control and per-Trip authorisation are ours to build (Keyhive not ready).
- **Verdict:** a "Trip as one Automerge document" is tempting for its simplicity, but it optimises for the wrong problem (concurrent editing of the same thing) and makes the server dumb exactly where a public product needs it smart.

### 8. Triplit

Full-stack syncing database with property-level CRDT merges, offline mode, relational queries, Vue bindings.

- **Status:** acquired by Supabase (October 2025); founder joined Supabase to work on sync-engine integrations. The repository's **last commit is from September 2025**. AGPL-3.0. Effectively unmaintained as a product.
- **Verdict:** rule out.

### 9. Jazz (v2)

Local-first relational database (Rust core, TypeScript-first) with row-level permissions, real-time sync and offline writes; official Vue bindings; Jazz Cloud or self-hosted server (`jazz-tools server`).

- **Conflict handling:** built-in local-first merging (CRDT-derived under the hood); permissions and migrations are type-checked.
- **Backend:** Jazz server / Jazz Cloud (its own storage), not Postgres.
- **Self-hosting:** yes, open source; Jazz Cloud has a free tier.
- **Maturity:** **Jazz 2.0 is a public alpha with an entirely new API**; "Classic Jazz" is the previous, different product. Very active (commits this week), but the API is moving.
- **Vue/Nuxt fit:** official `jazz-tools/vue`.
- **Lock-in / exit cost:** high. Data model, auth, permissions and storage are Jazz's.
- **Verdict:** the most "batteries included" open option on paper, but alpha. Worth watching; risky as the foundation of an MVP.

### 10. Also notable

- **LiveStore:** event-sourced reactive SQLite with a built-in sync backend. Events-as-truth is a great fit for an audit trail of Expenses. Still **pre-1.0 (0.4)**, no timeline for 1.0; Vue bindings are a community beta (`vue-livestore`).
- **Evolu:** local-first SQLite with end-to-end encryption and stateless relays you can self-host; privacy-first. Identity is an owner mnemonic; built-in account management is still being developed, which makes multi-person Trip sharing awkward today.
- **TanStack DB:** not a sync engine on its own but a reactive client store with collections for Electric, PowerSync, RxDB, IndexedDB and plain query APIs, plus an offline outbox. A useful client layer for option 1 that keeps the backend swappable.

## Comparison

| Option | Offline writes | Conflict model | Backend | Self-host | Cost (us / public) | Maturity (Oct 2026) | Vue / Nuxt | Exit cost |
|---|---|---|---|---|---|---|---|---|
| Custom (Dexie / TanStack DB + own API) | Yes (we build outbox) | Ours: per-record, server-validated | Any (Postgres/SQLite) | Yes | €0 / hosting only | Building blocks mature | Good | None |
| Dexie Cloud | Yes | Server-replayed operations; Y.js for text | Dexie Cloud server | Paid on-prem (€3.5k–8k one-off) | Free tier / per seat | Mature, small vendor | Good | Medium-high |
| RxDB | Yes | Client conflict handler, server returns conflicts | Any via HTTP replication | Yes | Free core / paid storages | Mature, single maintainer | OK | Low-medium |
| PowerSync | Yes (upload queue) | Server-authoritative via our API | Postgres, MongoDB, MySQL, SQL Server | Yes (Open Edition, FSL) | Free self-host / cloud from $49 | Mature, commercial | **Best** (official Nuxt module, alpha) | Medium-low |
| ElectricSQL | DIY (outbox or PGlite) | None for writes | Postgres | Yes (Apache-2.0) | Free self-host; Cloud winding down | Engine solid; acquired by Databricks | Via TanStack DB | Low |
| Replicache | Yes | Server reconciliation | Any | Yes | Free | Maintenance mode | Manual | Medium |
| Zero | **No** (rejected when disconnected) | Server reconciliation | Postgres + zero-cache | Yes | Free | 1.0 (June 2026) | Community | Low |
| Automerge / Yjs | Yes | CRDT, automatic | Doc relay | Yes (MIT) | Free | Active | Manual | Medium |
| Triplit | Yes | Property-level CRDT | Triplit server | Yes (AGPL) | Free | **Stale since Sept 2025** | Yes | High |
| Jazz v2 | Yes | Built-in local-first merge | Jazz server/cloud | Yes | Free tier / self-host | **Public alpha** | Official | High |
| LiveStore | Yes | Event log | LiveStore sync backend | Yes | Free | Pre-1.0 | Community beta | Medium-high |

**Ruled out on hard facts:** Zero (no offline writes), Triplit (unmaintained), Replicache (maintenance mode), ElectricSQL as the main answer (writes are DIY anyway and its company pivoted).
**Too early for an MVP foundation, worth watching:** Jazz v2, LiveStore.

## Shortlist for the grilling ticket

### A. Custom: local store + operation outbox + own sync API on Postgres

Dexie (or TanStack DB with `@tanstack/offline-transactions`) on the client; Nitro endpoints `push` (ordered domain operations with idempotency keys and per-record versions) and `pull` (changes since checkpoint, per Trip) on our Postgres.

- **For:** zero lock-in, no extra services, conflict rules designed for money (per Expense, server-validated, conflicts surfaced to Participants instead of auto-merged). The operation log doubles as edit history (an open fog patch on the map). Our data shape makes this a known, bounded problem.
- **Against:** we build and test the sync ourselves (outbox, retries, tombstones, local schema migrations, multi-tab). Slowest path to a first sync.

### B. PowerSync (self-hosted Open Edition) + Postgres + our write API

- **For:** reads, partial sync per Trip, local SQLite, reactivity and the upload queue are done; writes still go through **our** API, so conflict rules are still ours and server-validated. Official Nuxt module. Data stays in our Postgres, so exit cost is moderate. Free to self-host, cheap cloud if we do not want to run it.
- **Against:** one more service (plus its bucket storage) to run; SQLite-WASM in the browser (bundle size, Safari VFS quirks); FSL licence (fine for us, worth noting); Nuxt module is still alpha.

### C. Dexie Cloud (batteries included)

- **For:** fastest to a working, shared, offline Trip: auth, invites, per-realm access (= Trip sharing) and server-replayed operations out of the box; tiny backend for us to write. Cheap at our scale.
- **Against:** closed-source server unless we buy on-prem (€3.5k–8k); auth, sharing and server data live in their system, so going public ties the product to a small vendor; server-side features need their REST API.

### Questions the grilling ticket should settle

1. How much sync code are we willing to own versus run someone else's service? (A vs B/C.)
2. Must the server be authoritative and validate Expenses, or is automatic merging acceptable? (Most options can do the former; CRDTs cannot without extra work.)
3. What is the conflict granularity: whole Expense / Receipt, or field? And are conflicts shown to Participants or resolved silently?
4. Is Postgres a given for the backend? (Required by B; natural for A; irrelevant for C.)
5. How important is owning auth and sharing for the public phase? (Pushes away from C.)

## Sources

- PowerSync: [pricing](https://powersync.com/pricing), [licensing](https://powersync.com/legal/licensing-terms), [conflict handling](https://docs.powersync.com/handling-writes/handling-update-conflicts), [Nuxt integration](https://docs.powersync.com/client-sdks/frameworks/nuxt), [Nuxt module announcement (Mar 2026)](https://releases.powersync.com/announcements/nuxt-integration-for-powersync-alpha), [January 2026 changelog](https://powersync.com/blog/powersync-changelog-january-2026)
- Dexie Cloud: [docs](https://dexie.org/docs/cloud), [consistency](https://dexie.org/docs/cloud/consistency), [best practices](https://dexie.org/docs/cloud/best-practices), [pricing](https://dexie.org/pricing)
- RxDB: [conflicts](https://rxdb.info/transactions-conflicts-revisions.html), [premium](https://rxdb.info/premium/)
- Electric: [Cloud pricing (Apr 2026)](https://electric.ax/blog/2026/04/02/electric-cloud-pricing), [joining Databricks (Aug 2026)](https://electric.ax/blog/2026/08/11/electric-joining-databricks), [The New Stack coverage](https://thenewstack.io/databricks-electric-wasm-agentic-postgres)
- TanStack DB: [offline transactions](https://tanstack.com/db/latest/docs/guides/offline-transactions), [`@tanstack/offline-transactions`](https://www.npmjs.com/package/@tanstack/offline-transactions)
- Rocicorp: [Replicache status](https://replicache.dev), [Replicache offline](https://doc.replicache.dev/concepts/offline), [Zero connection / offline](https://zero.rocicorp.dev/docs/connection), [Zero 1.0 (InfoQ, Jun 2026)](https://www.infoq.com/news/2026/06/zero-version-1)
- Automerge: [Automerge 3.0](https://automerge.org/blog/automerge-3), [This Month in Automerge: July '26](https://automerge.org/blog/2026-july); Yjs: [offline editing](https://github.com/yjs/docs/blob/main/getting-started/allowing-offline-editing.md)
- Triplit: [joins Supabase](https://supabase.com/blog/triplit-joins-supabase), [repository](https://github.com/aspen-cloud/triplit) (last commit 2025-09-11, checked via GitHub API)
- Jazz: [docs](https://jazz.tools/docs), [What is Jazz? (v2 alpha)](https://jazz.tools/blog/what-is-jazz), [repository](https://github.com/garden-co/jazz)
- LiveStore: [state of the project](https://docs.livestore.dev/misc/state-of-the-project), [vue-livestore](https://github.com/slashv/vue-livestore)
- Evolu: [get started](https://www.evolu.dev/docs/local-first)

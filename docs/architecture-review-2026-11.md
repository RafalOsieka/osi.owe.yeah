# Architecture review after the MVP (2026-11-03)

Findings from the post-MVP review (#45–#73), to work through one at a time. Vocabulary: module, interface, seam, adapter, depth, leverage, locality (see `.claude/skills/codebase-design`). Domain terms are from `GLOSSARY.md`.

Status: `todo`, `grilling`, `decided`, `done`, `dropped`.

Two reviews feed this file:

- **The codebase review** (deep modules): the Candidates and Smaller findings below.
- **The system, security and spec review** (three parallel reviewers, earlier the same day): the "System, security and spec review" section. It was checked against `main` at `ce1289f`, and every finding listed there still held.

Every open item was checked again against `main` at `0be94a6` on 2026-11-11. Each item is now done, filed as an issue (#204–#226), dropped, or on the "Before a production instance" list. See "Catch-up (2026-11-11)" in Decisions.

## Context

- There is no production yet. The dev database can be dropped and rebuilt.
- The idea is to flatten `apps/migrator/migrations` (0000–0009) into one initial migration with the current tables before the first deploy.

## Candidates

### 1. Pull Trip sync out of the h3 handler (Strong). Status: done (together with #2; #77, #78, #80)

- **Files:** `apps/web/server/api/trips/[id]/push.post.ts`, `apps/web/test/unit/device.spec.ts` (`FakeServer`, `acceptAll`), `apps/web/test/e2e/api/trips.spec.ts`
- **Problem:** All of ADR 0002 on the server lives inside `defineEventHandler`, on the `getDb()` singleton: idempotency, Trip lock, conditional update by base version, Revisions, restoring Participants, Conflict and refusals. The only test runs through HTTP e2e and needs a Nuxt build. The client is tested against `FakeServer`, a second, hand-written version of the protocol that nothing keeps in step with the real one.
- **Direction:** One server "Trip sync" module that takes a db or transaction and handles both push and pull. The handlers become thin adapters. Protocol tests run directly against Postgres, and `device.spec` can run against the real module through an in-process `Transport`.
- **Check:** Does PGlite support `uuidv7()` (PG18)? If not, the `e2e-db` harness with Postgres 18 already exists.

### 2. One read of an Expense from the database, always through the domain schema (Strong). Status: done (together with #1; #77)

- **Files:** `push.post.ts:113-118`, `server/utils/reminders.ts:83-90`, `server/utils/rates.ts:36-41`, `server/utils/push.ts:211-237`, `revisions.get.ts`, `server/utils/trip-snapshot.ts:58-67` (the only path through `storedExpenseSchema.parse`)
- **Problem:** "Expense from a row" is written five times, and only the pull parses through the schema. Reminders, notifications and revisions read the raw jsonb, so zod defaults and transforms apply in only one place.
- **Note:** With no production and a fresh dev db, the pre-#61 bug (`BigInt(undefined)`) is theoretical. The structural risk stays: the next schema default will only work in the pull.
- **Direction:** One server Trip-store module for reads (Trip, Participants, live and deleted Expenses, Revisions), always through the domain schemas. Writes stay in Trip sync (#1). This fits naturally with #1.

### 3. One "Expense draft" module instead of logic in the forms (Strong). Status: done (together with #7; #82, #83)

- **Files:** `ExpenseForm.vue` (about 260 lines of logic), `RepaymentForm.vue`, `TillLine.vue:42-56`, `TillList.vue`, `utils/{receipt,contribution,manual-rate}-draft.ts`, `useManualRateErrors.ts`, `ExpenseCurrency.vue`
- **Problem:** Converting between a draft and an Expense is spread over about 8 modules, mostly in components.
  - The shallow drafts return `null` with no reason, so `TillLine` re-parses three times.
  - The inverse of `parseMoney` is copied five times.
  - Domain rules are duplicated in the UI: Income as a negative price, "recipient is not the payer", and "charged with a zero total".
  - There are no unit tests for any of it.
- **Direction:** A small interface: Expense to draft, and draft to either an Expense or per-field reasons. It covers the plain, Income, Receipt, Contribution, Manual rate and Repayment variants. Components keep layout and i18n.

### 4. The device syncs by itself after a change, and OpenTrip stops being a pass-through (Strong). Status: done (#85)

- **Files:** `composables/useOpenTrip.ts:20-92`, `pages/trips/[id].vue:84-190` (10× `void device.sync(tripId)`), 19 imports of `~/sync/*` outside `app/sync`
- **Problem:** The "sync after a local change" policy (ADR 0002) lives in a page. Each mutation has to remember to call sync, each with its own condition. Outbox details (`ExpenseBase`, `{ after: changeId }`, `NOTIFICATIONS_OFF`) leak into pages and forms. (Revised: the other `~/sync/*` imports are types that are part of the interface, plus pure functions over `LocalTrip`; only `ExpenseBase` is a leak.)
- **Direction:** The device schedules sync on every enqueue and offers a handle per Trip with `tripId` bound. Base is hidden behind "the Expense as it was read".

### 5. Notification subscriptions as their own module next to sync (Worth exploring). Status: decided (#208)

- **Files:** `app/sync/device.ts` (704 lines at the review, 810 at `0be94a6`), `test/unit/device.spec.ts` (646 lines)
- **Problem:** Web Push subscription reconciliation (about 120 lines, with its own state machine) is coupled to the outbox loop (`syncOnce` → `syncSubscription`). There are also three online-only pass-throughs: `revisions`, `reminderStatus` and `remind`.
- **Direction:** Make a separate reconciler over the same db and `Transport`, called after sync. Online-only calls go straight to `Transport`.

### 6. Rules for applying an Expense change in the domain, not twice (Worth exploring). Status: decided (#209)

- **Files:** `push.post.ts:205,238-247`, `app/sync/local-trip.ts:119,181,212-220` (`restoredBy`), `app/sync/device.ts:371`
- **Problem:** Two rules are written on the server and twice on the client, with a hand-copied `deleted` exception:
  - "A non-deleted accepted change restores the Participants it references."
  - "Validate with removed Participants included."
- **Direction:** The domain exports the rule ("the Trip's Participants after this Expense change"), not just its ingredients. Don't go as far as a shared reducer; the SQL update stays the arbiter.

### 7. Expense kind named in the domain (Worth exploring, small). Status: done (together with #3; #82)

- **Files:** `ExpenseList.vue:74-83`, `ExpenseDetails.vue:43,72,138`, `ExpenseVersion.vue:27`, `packages/domain/src/expense.ts:132`
- **Problem:** The kind is decided ad hoc in three components. For a Receipt where the Deposit refund exceeds the goods, the list says Receipt while the details and the version say Income. `isReceipt` is not a type guard.
- **Direction:** One domain function names the kind (plain | Income | Receipt | Repayment) and narrows the type.

## Smaller findings (bugs and inconsistencies)

- [ ] **Lost update across tabs.** In `device.ts:104,393-397`, `acceptedVersions` lives in memory. If another tab accepted the change, `resolveBase` takes `current.version` and can overwrite someone else's version without a Conflict. **Issue:** #212.
- [x] **A retry loses `restored`.** In `push.post.ts:84-91`, `appliedBefore` returns no restored Participants, so after a lost response the Notice does not show. Done in #79: the `changes` row keeps them.
- [ ] **The Conflict screen gets the wrong list of people.** `conflict.vue:75,112` uses `trip.participants` instead of `everyone`, so a removed Participant shows as "?". Since #138 it also names the other side's author ("{name}'s version") and feeds the "for all N" check in `ExpenseVersion.vue`, so both can misreport too. #197 fixed "for all N" only in the Expense details, not on the Conflict screen (`conflict.vue:26,75,112`). **Issue:** #211.
- [x] **A Manual rate rule exists only in the UI.** "Charged with a zero total" is checked only in `useManualRateErrors.ts:22`. The domain and server accept it, `conversionRate` returns `null`, and the Expense drops out of balances without a word. A Manual rate in the Expense's own currency is likewise stripped only by the UI. Done in #82 (the domain refuses both) and #83 (`useManualRateErrors` is gone).
- [ ] **The Web Push payload is not validated.** `service-worker/sw.ts:35` casts `as PushMessage` even though `pushMessageSchema` exists. The payload has no schema version, and `notification.ts` has a third amount formatter. **Issue:** #213 (`safeParse` with a generic fallback; no version field, since S7 covers drift).
- [ ] **Rename the domain type `TripSnapshot`.** The glossary says "Avoid: snapshot". It is used in `PullResponse` and on the client. **Issue:** #226 renames it to `ServerTrip`, pairing with `LocalTrip`. `TripState` was rejected because `ExpenseState` means something else. The stored Dexie field keeps its name.
- [x] **"Notice" is not in the glossary.** Done on 2026-11-11 (see Catch-up). It covers in-app messages, such as "Participant restored" or a rejected change.
- [x] **"Push" means two things:** sync push and Web Push. Neither is in `GLOSSARY.md`, and neither are "Notice", "Recently deleted" or "History". `TripSnapshot` clashes with "Avoid: snapshot". Done except `TripSnapshot` (its own item above): **Notification** has "Avoid: Push", which settles Web Push. **Notice**, **History** and **Recently deleted** were added on 2026-11-11. The sync push stays protocol vocabulary (ADR 0002), not a glossary term.
- [x] **Fire-and-forget calls.** `void notifyAffected(…)` and `void deliver(…)` run without `event.waitUntil`. That is fine on Node and fragile on serverless. Dropped on 2026-11-11: the app runs on Node in Docker, and no serverless deploy is planned.
- [x] **`tools/tricount-import`** duplicates token generation and `hashTripToken`, and copies the schema. After #73, either delete it or share the hash. **Issue:** #221 deletes it, since the import is done. Done in #221.
- [ ] **The domain interface is wide.** About 19 exports of `packages/domain` are unused outside the package (`changeResultSchema`, `syncChangeSchema`, `tripSnapshotSchema`, `lineItemSchema`, `parseAmount`, `localDay`, …). **Issue:** #222, after #209.
- [x] **Flatten the migrations** into one initial migration (no production yet). Done in #75: `0000_init.sql`.

## System, security and spec review

Three read-only reviewers looked at:

- **the system:** the boundaries between apps, data flow, deploy, CI and tests
- **security:** mainly ADR 0001, the Trip link as the credential
- **the code against spec #19**, story by story

They found no reason to reopen ADR 0001–0003, and 121 of the 126 stories are done. **Overlap** names the candidate or ticket above that already covers a finding, fully or in part.

### P1: before the first real Trip

- [ ] **S1. No Postgres backups** (system H1, spec story 121, missing).
  - **What's at risk:** the production compose (now `deploy/osieka-dev/compose.yaml`) keeps everything on one volume on one host: the Revisions kept forever, the fixed rates ADR 0003 forbids changing, and the token hashes. The VAPID keys live only on the host.
  - **Fix:** a nightly `pg_dump` with 30-day retention, copied off the host together with the stack's secrets, and one restore drill. No ticket covers this yet.
  - **Scoped to test on 2026-11-11:** a dump before each migration (#206), plus the off-host copy, the secrets and a restore drill (#207). Nightly dumps wait for a production instance.
  - **Done in #206:** a `backup` compose service dumps before every `migrate` and keeps the last 5; the runbook restores one. #207 is still open.
- [ ] **S2. One malformed change blocks the whole Trip's sync, with no message** (system H2).
  - **Server:** the sync push validates the whole body and answers 400 for all of it.
  - **Device:** queuing a change parses nothing, the shape is guarded only by forms, sync swallows the error, and the outbox resends the same first 100 changes forever. The user's only way out is "Forget anyway", which loses data.
  - **Fix:** validate with the wire schema when a change is queued. The server parses each change on its own and answers only the bad one `rejected: ['malformed']`, so it goes through the existing "not synced" flow.
  - **Overlap:** #78 (Trip sync module) is where per-change parsing on the server belongs. The device side is a missing seam, a candidate for a grilling.
  - **Issue:** #205.
- [x] **S3. Blind SSRF through a push subscription** (security M1, system L4). Done: #204 takes and sends to known push services only, and delivery follows no redirect.
  - **The hole:** the subscription endpoint only checks for `https:`, and delivering a Notification follows redirects, so a request can reach `http://` addresses on the internal network. A Trip can be created anonymously, there is no cap on subscriptions, and the 404/410 pruning leaks one bit through `reachable`.
  - **Fix:** an allowlist of push-service hosts (FCM, Mozilla, Apple, WNS), `redirect: 'error'` on the fetch, a cap on subscriptions per Trip, and a limit on outbound concurrency.
  - **Issue:** #204 (the allowlist and `redirect: 'error'`; the cap and the concurrency limit moved to S9).
- [x] **S4. The rate limiter and `X-Forwarded-For`** (security M2, system M4). Done: #117 sets `ipHeader: 'cf-connecting-ip'`, and since #119 a refused Reminder is read from the server's `{ refused }` body. Exempting pulls was dropped: the sync plugin makes about 10 pulls in 5 minutes per open Trip, against a limit of 150. Revisit only on a real 429.
  - **The problem:** nuxt-security keys its limiter on the left-most `X-Forwarded-For` entry. Depending on the proxy, the limiter is either bypassable, or every user shares one bucket. A group on one hotel Wi-Fi exhausts 150 requests in 5 minutes.
  - **Symptoms in the app:** a 429 from the limiter shows as "Reminded today", and a 409 from the schema middleware shows as "the debtor can't be notified".
  - **Fix:** set `rateLimiter.ipHeader` to a header the proxy overwrites. Reminder answers carry `{ reason }`, and the app maps on that, not on the status code. Consider exempting pulls from the limiter or raising its limit.
- [x] **S5. History shows Revision totals in the wrong currency** (done in #152, which closed #140) (spec story 98). `history/index.vue:18` formats with the Trip currency, while the totals are in the Expense's currency, so a USD Expense reads "PLN". It is a plain bug. Partly fixed in #138: each Revision's total now uses its own currency. The "was" total before an edit still uses the newer Revision's currency (`history/index.vue:34,59`), tracked in #140.

### P2: before the next change to the shape of stored data

- [x] **S6. The server's stored Expense JSON has no way to evolve** (system H3). Done: the cast is gone, and `apps/web/test/unit/stored-expenses.spec.ts` parses a fixture of every stored shape and says how a change to the shape keeps them parsing.
  - **The problem:** `jsonb().$type<ExpenseState>()` is a cast, not a parse, and Revisions keep every historical shape forever. If one bad row fails to parse, the whole pull for that Trip answers 500.
  - **Fix:** drop the `$type` cast so that skipping the parse is a type error; keep a JSON fixture per historical shape, with a test that each still parses; break changes with a SQL JSONB migration for `expenses.state`, and upgrade Revisions when they are read.
  - **Overlap:** #77 (Trip store) parses every read through the domain schemas. The fixtures, the cast and the policy for upgrading Revisions are not in #77.
  - **Issue:** #214.
- [x] **S7. Nothing forces a sync schema version bump** (system M1). Done: `packages/domain/test/wire-contract.spec.ts` snapshots every wire schema with the version and says how to decide.
  - **The problem:** the client parses responses strictly, so a new problem code or currency breaks older apps unless someone remembers to bump. #82 bumps by hand for exactly this reason.
  - **Fix:** a contract test that snapshots `z.toJSONSchema()` of every wire schema (push, pull, Revisions, Web Push payloads) together with `SYNC_SCHEMA_VERSION`, so CI fails until a bump or an explicit "safe" is decided. **Issue:** #215.
- [ ] **S8. Frankfurter sits on the pull's critical path** (system M2, security L1).
  - **The problem:** rates are fetched one currency at a time, with a 10 s timeout each. Any Expense date and currency is allowed, so a Trip member can drive many fetches. The `retryAt` map has no bound.
  - **Fix:** answer with what the rate table holds and fill it in the background; bound the Expense instant (e.g. 1999-01-04 to a year ahead); only ask Frankfurter for currencies it covers; make `retryAt` an LRU.
  - **Overlap:** #78 puts the pull with its rates inside the Trip sync module, which is the natural place for this.
  - **Issue:** #216 (rates filled in the background, the instant bounded, `retryAt` an LRU).
- [ ] **S9. No limits on the amount of data** (security M3).
  - **The problem:** Trips are created anonymously, with no cap on Participants, Expenses or Revisions, and the body limit is 2 MB.
  - **Fix:** per-Trip caps (100 Participants, as the existing schema already says), about 256 KB for the `/api` body, and a separate limit on creating Trips.
  - **Also from S3:** a cap on subscriptions per Trip and a limit on concurrent outbound deliveries. Today the 100-Participant cap is checked only when a Trip is created, and Trip sync never counts Participants added later.
  - **Found while grilling:** a 101st live Participant syncs, and from then on every device's pull fails to parse, silently. **Issue:** #223 (bug). Done in #223: Trip sync refuses a Participant change or an Expense change that would make a 101st live Participant (`tooManyParticipants`), and the app offers no Add at 100.
  - **Issue:** #224.
    - At most 2,000 Expenses per Trip; Revisions are not capped.
    - At most 10 new Trips per IP per hour.
    - At most 200 subscriptions per Trip; delivery sends at most 10 at a time.
    - **The 2 MB body limit stays:** one large Receipt is about 2 MB, so 256 KB could block a legitimate outbox forever.
- [ ] **S10. Failures are silent at both ends** (system M3).
  - **Device:** every sync error is swallowed.
  - **Server:** problems only reach `console.warn`, and the app has no healthcheck.
  - **Fix:** keep the last sync error per Trip on the device and show it next to the unsynced count; add `/api/health` with a compose healthcheck; send logs somewhere they get read.
  - **Partly done:** `/healthz` checks the database (#116), and compose has a healthcheck on it (#124). Still open: the device swallows sync errors (`device.ts:586`), keeps no last error per Trip, and logs only reach `console.warn`.
  - **Issue:** #225. The device tells offline from a server error and keeps `lastFailure` per Trip in memory, and the header indicator explains which one it is. Shipping logs is dropped for test and goes on the production list.

### P3: hardening and small items

- [ ] **S11. The app connects to Postgres as the superuser.** The app gets a role with read/write on the tables only; the migrator keeps the owner role. Deferred on 2026-11-11 to "Before a production instance": the role's password can't live in a generated, committed migration, and on test it is only defence in depth.
- [ ] **S12. The CSP is weak.**
  - **The gaps:** no `default-src` or `connect-src`, and `script-src` allows `'unsafe-inline'` and `https:`.
  - **Fix:** add `default-src 'self'` and `connect-src 'self'`, then check the headers a production build actually sends.
  - **Issue:** #217.
- [x] **S13. The Tricount share token is a CLI argument**, so it lands in shell history and the process list. Read it from stdin, a hidden prompt or an environment variable. Goes with the tool in #221. Done in #221.
- [ ] **S14. The sync push parses its body before checking the token**, and a creation push tells whether a Trip id exists, which contradicts a comment in the Trip access code.
  - **Fix:** check the link first. In #78 this means the HTTP adapter must not fully parse before the module checks the link, or the comment changes.
  - **Decided on 2026-11-11:** checking the link first is in #205. The second half is dropped, because Trip ids are UUIDv7 and guessing one is infeasible. #205 corrects the comments in `sync.ts` and `store.ts` instead.
- [ ] **S15. The pull reads its snapshot outside a transaction.** One snapshot can hold an Expense whose newly added Participant it doesn't yet show. **Overlap:** #77's single whole-Trip read can run in one `REPEATABLE READ` transaction. **Issue:** #218.
- [x] **S16. CI doesn't check that the Drizzle schema matches the migrations.** Add `drizzle-kit generate` followed by `git diff --exit-code`. **Issue:** #219. Done: the `lint` job generates and fails on any change under `apps/migrator/migrations`, new files included.
- [ ] **S17. Playwright tests only Chromium**, though the spec's top risk is iOS Safari. Add a WebKit project for the offline and sync journeys. **Issue:** #220.
- [x] **S18. Deploys build on the production host**, without tagged images, and migrations only go forward. Acceptable for now, with a backup (S1) before every deploy. Done in #124 and #127 (ADR 0005): hosts pull GHCR images pinned by digest. Forward-only migrations are now a decision recorded in ADR 0005. A dump before each deploy is done in #206.
- [x] **S19. Spec story 101 is half done.** The Revision keeps its `deviceId`, but the endpoint doesn't return it. Either use it or drop the story. Dropped on 2026-11-11 through #19's amendments.
- [ ] **S20. Classifying a change** (added, changed, deleted, restored) exists twice: in the server's Notifications code and in the app's Revisions utilities. **Issue:** #210. A domain `revisionKind`, and "edited" everywhere, the Web Push payload included.

### Spec #19 has aged, not the code

Update #19 to say:

- Units and Amounts cover _at most_ the whole, not _exactly_ the whole.
- Income also has a negative Line item. Read this with the narrowed Income in `GLOSSARY.md`.
- Settled needs at least one Expense.
- Balances are diverging bars (#53), not a table.
- The share breakdown opens from a saved Receipt and from Balances, not while entering (PR #65).
- History needs a connection.
- Story 3: the QR code is made offline, but joining needs signal.
- The importer also needs `--origin`.
- "No code yet" is out of date.

Tracker: #19 was closed on 2026-11-03 without these updates, and #27 is closed with all 12 checkboxes unticked although PR #57 did the work. Decided on 2026-11-11: the stories in #19 stay as written, and an "Amendments (2026-11)" section at the end of its body lists the points above. #27's boxes get ticked. "No code yet" is already gone.

## Decisions

<!-- Fill in during grilling: candidate, decision, why. -->

### #1 + #2: server Trip sync and Trip store (grilling, round 1)

- **Scope.** The Trip sync module covers both push and pull. The pull includes rates, and the module calls the existing `loadTripRates`. That way it returns exactly what the client's `Transport` expects.
- **#2 is part of the same work.** Reads (Trip, Participants, live and deleted Expenses, Revisions) go through one Trip store module, always via the domain schemas. Trip sync, reminders, notifications and `revisions.get` all use it. Writes stay in Trip sync.
- **Database.** The module is built by a factory `createTripSync(db)`. Handlers no longer reach for `getDb()` directly in the logic.
- **Tests.** They run against real Postgres 18 from the existing Docker harness, with a fresh database per file via `runMigrations`. No PGlite: we need `uuidv7()` and `FOR UPDATE`.
- **Notifications.** The module receives a notifier when it is created and calls it only for freshly applied Expense changes, so a retry does not notify again. Production uses the Web Push adapter; tests use a recorder or no-op adapter.

Round 2:

- **Interface mirrors `Transport`.** The module exposes `push(tripId, token, request)` and `pull(tripId, token, since?)`; each returns the response or `'invalidLink'`.
  - **Inside the module:** checking the Trip link (ADR 0001, `requireTrip`) and creating the Trip on its first push (`createTripIfMissing`). A token too weak to create a Trip gives `'invalidLink'`, and the adapter answers 401; today that case is a 400.
  - **In the HTTP adapter:** the router param, the header, zod validation of the body, 401, and the 426/409 middleware.
- **Trip store** has a single read of the whole Trip, `readTrip(tripId, tx?)`, plus `revisions(tripId, expenseId)`.
  - `readTrip` returns the Trip, its Participants and its Expenses, removed and deleted ones included, parsed through the domain schemas.
  - Consumers filter for themselves. Narrower queries only if a measurement shows they are needed.
- **Rates** become a small module built by a factory from `db`, passed to Trip sync and reminders. The rates logic stays the same. Frankfurter stays behind its URL variable.
- **`FakeServer` goes away.**
  - The sync scenarios in `device.spec` move to the database project and run on `createDevice` plus an in-process `Transport` over the real Trip sync, with a thin network decorator (`offline`, `loseResponses`).
  - Scripted answers such as a Conflict are replaced by real two-device scenarios.
  - `subscribe`, `remind` and `reminderStatus` are stubs until #5.
- **Location:** `apps/web/server/trip/` (`store.ts`, `sync.ts`, `rates.ts`), not `server/utils` (auto-import). Tests go in `apps/web/test/db/trip/`.
- **"Push" means only the sync push on the server.**
  - Web Push moves to `server/notifications/`, which holds the notifier adapter.
  - `requireDeviceId` moves to the subscription handlers.
  - The domain and the service worker stay as they are until #5.
- **Migrations are flattened in a separate, small PR before #1:** a single `0000_init.sql` from `drizzle-kit generate`, and the dev database rebuilt.

Round 3:

- **Composition root.** `server/trip/index.ts` is the only place that calls `getDb()`, apart from the subscription handlers. It lazily builds the store, rates, notifier and Trip sync. Reminders and notifications also read through the Trip store.
- **A retry keeps `restored`.** A `restored uuid[]` column is added to `changes`, and `appliedBefore` returns it the same as the first time. This ships in the same work, as migration `0001` after the flattening. The other small bugs stay on the list.
- **What stays in `e2e-api`:**
  - 401 without a valid token, for both push and pull
  - 426/409 for a schema mismatch
  - 400 for a malformed body
  - one round trip of creating offline, then pulling
  - registering a subscription with the Trip link
  - one real notification through the push-service stand-in
  - reminders

  The rest, about 25 tests, moves to the module tests.

- **PRs, in order:** A flattens the migrations. B adds the Trip store, rates, Trip sync and notifier, the rename to `server/notifications/`, handlers as adapters, `restored`, and the module tests. C moves `device.spec` onto the real module and removes `FakeServer`.
- **Issues.** One GitHub issue per PR, labelled `ready-for-agent`, created once a shared understanding is confirmed.

Checked against GLOSSARY and ADRs:

- **Checking the Trip link (ADR 0001)** lives in the Trip store as `tripByLink(tripId, token)`, which returns the Trip with its version or `null`, hashing the token inside. Trip sync uses it internally. `requireTrip(event)` stays as a thin HTTP adapter for the other handlers (revisions, reminders, subscriptions). Creating the Trip on its first push stays in Trip sync.
- **The sync schema version** (426/409) stays in the HTTP middleware. An in-process client is always built from the same code as the server. The path where an update is needed is covered by the client's `migrations.spec` and by e2e-api.
- **Reading the whole Trip under the lock on every change is accepted.** It costs the same order as the whole-Trip pull of ADR 0002 and happens less often. Don't narrow the read without a measurement showing the lock is too long.
- **Glossary:** added **Notification** (Powiadomienie). "Notice" is not part of this plan.
- **ADR 0004:** client sync is tested against the real server module, not a fake server.
- **"Snapshot"** goes away on the server (`loadTripSnapshot` becomes `readTrip`). Renaming the domain type `TripSnapshot` goes on the small-findings list.

### #3 + #7: Expense draft module and Expense kind (grilling, round 1)

- **Location.** A pure TypeScript module in the app, with no Vue and no i18n, tested in the `unit` project. Not in `packages/domain`: a draft is text as typed in a form (amounts as strings, a list key, empty meaning none).
- **Scope.** One module with two kinds of draft: a split Expense (plain, Income, Receipt, Contributions, Manual rate) and a Repayment. The kinds share their common parts: Manual rate, amount as text, time, title.
- **#7 is part of the same work.** A domain function names an Expense's kind and narrows its type. The draft and the three components that classify Expenses ad hoc today use it.
- **Domain problems show at their fields before saving.** Once the draft makes an Expense, the module runs `expenseProblems` and assigns each problem to a field. One list carries both unreadable fields and domain problems. The note above Save stays only for refusals the client couldn't foresee. `RepaymentForm` loses its own recipient-not-payer check.
- **Rules that live only in the UI move to the domain**, so that the device and the server also refuse them:
  - a Manual rate "charged" against a zero total (`chargedWithoutTotal`)
  - a Manual rate targeting the Expense's own currency

  The draft still drops such a Manual rate silently when the Expense is switched to the Trip currency. `useManualRateErrors` goes away.

Round 2:

- **Glossary: Income is narrowed** to "an Expense with a single Line item of negative amount". A Receipt whose Deposit refunds outweigh its goods stays a Receipt. "Plain Expense" stays a descriptive phrase, not a term.
- **The interface:**
  - `readDraft(draft, trip)` returns the Expense once it is complete, the Receipt as far as it can be read so far (for live totals), and the reasons per field.
  - `readLineItem(line, currency)` returns the Line item or the reasons. `TillLine` uses it, and so does `readDraft`.
  - Functions that make a draft: from an Expense, and a new one.
  - None of these return a bare `null`. The form reads the same result both live and when saving.
- **Reasons are codes with their field**, e.g. `{ field, code }`, with a line key for Line items. Domain codes are the `ExpenseProblem` names. A single composable turns them into i18n text, reusing the existing keys.
- **No hidden dependencies.** "Now", the device time zone, the Claim and the last-used currency are arguments.
- **Transitions that carry a rule are in the module:**
  - itemise as a Receipt
  - a Main payer cannot have a Contribution
  - a new Split mode starts from scratch

  Plain toggles stay in the components.

- **Tests:**
  - Unit tests cover the draft round trip (Expense → draft → Expense) for every variant, plus reasons and transitions.
  - Domain tests cover Expense kind and the two new Manual rate rules.
  - UI e2e keeps one happy path per variant (plain, Income, Receipt with discount, Deposit and Deposit refund, Contribution, Manual rate, Repayment), plus one test showing a domain problem at its field before saving.

Round 3:

- **The sync schema version goes up from 1 to 2 with the new Manual rate rules.** The client parses `problems` as an enum, so an older app would break on a code it doesn't know. The outbox keeps its shape, so the client store needs no new migration link. Having the client tolerate unknown problem codes is YAGNI while there is no production.

### #4: the device syncs by itself after a change

- **The device syncs after a change.** Every device mutation the server must hear about (outbox changes, Keep mine, creating a Trip) starts a sync of the Trip on its own, once its transaction commits, from a single internal place. It doesn't wait for that sync. Mutations still resolve after the local write. Tests settle with `await device.sync(tripId)`, which joins the sync already running. This is not a Dexie hook on the outbox, because not every change goes through the outbox.
- **The same rule applies to subscriptions.** Changing the Claim while notifications are on, and turning notifications on or off, also start a sync. The device knows whether a subscription exists; the page does not.
- **Every `void device.sync(...)` in pages goes away.** An explicit `sync()` stays only for pull-to-refresh and for the sync plugin (on app open, focus, going online, and every 30 s).
- **A handle per Trip.** `device.trip(tripId)` exposes the mutations with `tripId` bound. `OpenTrip` is derived from that handle's type, plus the reactive view (`trip`, `claim`, `everyone`, `notices`, `unsynced`, `link`) and the UI actions ("Who are you?", Invite). Each mutation is documented once, on the device.
- **Base is hidden behind "the Expense as it was read".** `saveExpense` and `deleteExpense` take the `LocalExpense` as it was read, or `null` for a new one, instead of an `ExpenseBase`. A Conflict still fires on a pull made during an edit. `ExpenseBase` is no longer visible outside `app/sync`.
- **The other `~/sync/*` imports stay.** Types and pure functions over `LocalTrip` (`findExpense`, `toExpense`, `NOTIFICATIONS_OFF`) are part of the interface.
- **Order and scope.** Blocked by #80 (ADR 0004), so the new device tests are written against the real Trip sync. #5 stays separate.
- **As built (#85).** `sync(tripId)` joins the sync already running without asking for another; only a change made meanwhile runs it once more. Opening a Trip (`open()` on its handle) still syncs it, as the page did, and a renewed browser subscription syncs the Trips it changed.

### #5: notification subscriptions (decided on 2026-11-11; Q1–Q4 as recommended, Q5 moot since #85 shipped)

Findings that correct the original candidate:

- **The ordering is deliberate.** Reconciling subscriptions runs at the end of a sync on purpose. A Trip created offline exists on the server only after its push, so subscribing earlier gets 401. A subscription left over from a forgotten Trip has to go before a new one. If the code is split out, sync still calls it: this is an internal seam with one adapter, not a new interface.
- **The online-only calls (`revisions`, `reminderStatus`, `remind`) are not empty pass-throughs.** They keep the Trip link token away from pages, so they pass the deletion test better than the candidate claimed.

Round 1 questions, each with the recommendation. Q1–Q4 were accepted as recommended on 2026-11-11:

- **Q1.** Extract the subscription reconciler as an internal device module named "notifications" (not "push"), over the same db and `Transport`? It holds wanted vs registered, `subscribedThisRun`, forgotten Trips, and on/off/decline/renew. Sync calls it at the end of a run, and forgetting a Trip calls it too. Nothing changes outside the device. The alternative is to leave it as it is, since #85 reshapes the device anyway. **Recommended: yes, kept small.**
- **Q2.** A Claim change and turning notifications on or off still trigger a full sync, as #85 decided, rather than a subscription-only trigger? **Recommended: yes.**
- **Q3.** The online-only calls stay on the per-Trip handle? **Recommended: yes.**
- **Q4.** Subscriptions stay as stubs in the in-process `Transport` of the device tests, as ADR 0004 allows, and the server side of subscriptions is untouched? **Recommended: yes (YAGNI).**
- **Q5.** Blocked by #85 (which is blocked by #80)? **Recommended: yes.**

Remaining candidates after #5: #6 (rules for applying an Expense change in the domain), then the small findings.

### Catch-up (2026-11-11)

All tickets from the review (#75–#85) are closed, along with #140 and #170, which were spun off from findings. Every open item was checked again against `main` at `0be94a6`. S4, S5 and S18 are done. S10 and the glossary item are partly done.

- **Next, in order:** S3 (blind SSRF: test is public, and anyone can create a Trip anonymously), then S2 (one malformed change blocks a Trip's sync), then S1 (backups; partly `ready-for-human`, because copying backups off the host involves private infra). Each gets a grilling round and then an issue.
- **Then #5**, as decided above, **then #6.**
- **S4's "exempt pulls from the limiter" is dropped.**
- **Spec #19 is amended, not rewritten** (see "Spec #19 has aged"). Done: #19 has an "Amendments (2026-11)" section, and #27's boxes are ticked.
- **Glossary:**
  - **Notice** (Komunikat): what sync has to tell one device. It covers a removed Participant brought back, a refused removal or Trip currency change, and someone else removing the Participant the device claims. A Notice stays until dismissed. A Notification, by contrast, reports someone else's activity.
  - **History** (Historia): an Expense's Revisions.
  - **Recently deleted** (Ostatnio usunięte): keeps its name even though nothing leaves it; "Recently" describes the order.
  - All three were added because the UI copy already uses them as proper nouns.

#### S3: blind SSRF through a push subscription (decided)

- **A server-only allowlist,** one function used in two places: the subscription handler refuses with a 400, and delivery skips the endpoint, which covers rows stored earlier. It stays out of the shared `subscriptionRequestSchema`, so adding a push service needs no new app version.
- **Hard-coded hostname suffixes, https on port 443 only:** `fcm.googleapis.com`, `push.services.mozilla.com`, `push.apple.com`, `notify.windows.com`. There is no runtime-config list. A refused endpoint logs its host. The test flag `notificationsAllowHttp` becomes `notificationsAnyEndpoint`, which admits any endpoint, plain http included, in tests only.
- **Delivery uses `redirect: 'error'`.** A redirect counts as a network error and is not pruned.
- **The subscription cap per Trip and the outbound concurrency limit move to S9.** With the allowlist, nothing reaches the internal network. What's left is resource use, and anonymous Trip creation makes that S9's ground.
- **The bit leaked through `reachable` needs no work of its own.** A 404 or 410 can now only come from a real push service.
- **The device gets no new handling for a refused subscription.** It retries on each sync and shows nothing, as it does with any sync error until S10.
- **Issue:** #204.

#### S2: one malformed change blocks the whole Trip's sync (decided)

Facts: the server already answers each change on its own, keyed by `changeId`. Only the adapter's body parse is all-or-nothing. A rejected Expense change is held on the device (not synced, fix or discard). A rejected Trip or Participant change is removed from the outbox, silently unless it is `participantReferenced` or `tripHasRepayments`. `beforeReceipts` in `migrations.ts` keeps an unreadable row as it was, which is one real way to get a malformed outbox row.

- **The server parses each change on its own.** The HTTP adapter parses only the envelope (`changes: [{ id }]`, 1 to 100). Trip sync parses each change with `syncChangeSchema` and answers a failure `{ status: 'rejected', problems: ['malformed'] }`. An unreadable envelope or change id still gets a 400.
- **S14's first half comes with it.** Trip sync checks the Trip link before it reads any change. S14's second half (a creation push reveals whether a Trip id exists) stays open.
- **The sync schema version goes up from 2 to 3** for the new `malformed` problem code.
- **The device parses at enqueue.** One `queuedChangeSchema` in `app/sync`, derived from the domain's change schemas with `base` in place of `baseVersion`. `enqueue` stores the parsed output, trimmed names included, and throws on failure, because the forms already guard the shape and a failure is a bug. The `as QueuedChange` cast goes away.
- **What the device does with `malformed`:**
  - An Expense change is held through the existing flow, with a note above Save.
  - A Trip or Participant change is removed as today, but now with a Notice: one new generic kind, `changeRefused`, says which Trip detail or Participant the change was about.
- **No re-check at push time.** Rows already in an outbox go as they are, and the server's `malformed` answer routes them.
- **Issue:** #205.

#### S1: backups (decided, scoped to test)

Test is the only instance. Its terms say the data may be wiped and shouldn't be anyone's only record.

- **Now:** only a dump before each migration, which guards against the likeliest loss, a bad forward-only migration.
  - A one-shot `backup` compose service on `postgres:18-alpine` writes to a `backups` volume and keeps the last 5 dumps. `migrate` depends on it, so a failed dump stops the deploy.
  - The runbook gets a restore section, and the privacy notice says that the copies exist and how long erased data stays in them.
- **Human, private:** copying the dumps off the host, the secrets in a password manager, and one restore drill.
- **Later, a gate for a production instance:** nightly dumps with 30-day retention.
- **Issues:** #206 (agent), #207 (human, blocked by #206).

#### Triage of the rest (2026-11-11)

- **Filed:**
  - #208 (#5), #209 (#6), #210 (S20)
  - #211 (Conflict screen), #212 (lost update across tabs), #213 (Web Push payload)
  - #214 (S6), #215 (S7), #216 (S8), #217 (S12), #218 (S15), #219 (S16), #220 (S17)
  - #221 (delete `tools/tricount-import`, which takes S13 with it), #222 (wide domain interface, after #209)
- **Dropped:** fire-and-forget calls (Node only), S14's second half (UUIDv7 ids, comments corrected in #205), S19 (story 101 dropped in #19's amendments).
- **Grilled afterwards:**
  - #223 (the Participant cap, a bug found on the way), #224 (S9), #225 (S10), #226 (`TripSnapshot` → `ServerTrip`)
  - S11 deferred

#### Before a production instance

These are not needed on test, whose terms say its data may be wiped. They gate opening a production instance:

- nightly dumps with 30-day retention, on top of #206
- logs that someone reads, beyond rotating container logs, `/healthz` and the tunnel alerts
- an app database role with read/write on the tables only (S11)

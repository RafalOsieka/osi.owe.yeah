# Architecture review after the MVP (2026-11-03)

Findings from the post-MVP review (#45–#73), to work through one at a time. Vocabulary: module, interface, seam, adapter, depth, leverage, locality (see `.claude/skills/codebase-design`). Domain terms are from `GLOSSARY.md`.

Status: `todo`, `grilling`, `decided`, `done`, `dropped`.

Two reviews feed this file:

- **The codebase review** (deep modules): the Candidates and Smaller findings below.
- **The system, security and spec review** (three parallel reviewers, earlier the same day): the "System, security and spec review" section. It was checked against `main` at `ce1289f`, and every finding listed there still held.

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

### 4. The device syncs by itself after a change, and OpenTrip stops being a pass-through (Strong). Status: decided

- **Files:** `composables/useOpenTrip.ts:20-92`, `pages/trips/[id].vue:84-190` (10× `void device.sync(tripId)`), 19 imports of `~/sync/*` outside `app/sync`
- **Problem:** The "sync after a local change" policy (ADR 0002) lives in a page. Each mutation has to remember to call sync, each with its own condition. Outbox details (`ExpenseBase`, `{ after: changeId }`, `NOTIFICATIONS_OFF`) leak into pages and forms. (Revised: the other `~/sync/*` imports are types that are part of the interface, plus pure functions over `LocalTrip`; only `ExpenseBase` is a leak.)
- **Direction:** The device schedules sync on every enqueue and offers a handle per Trip with `tripId` bound. Base is hidden behind "the Expense as it was read".

### 5. Notification subscriptions as their own module next to sync (Worth exploring). Status: paused (round 1 asked, not answered; see Decisions)

- **Files:** `app/sync/device.ts` (704 lines), `test/unit/device.spec.ts` (646 lines)
- **Problem:** Web Push subscription reconciliation (about 120 lines, with its own state machine) is coupled to the outbox loop (`syncOnce` → `syncSubscription`). There are also three online-only pass-throughs: `revisions`, `reminderStatus` and `remind`.
- **Direction:** Make a separate reconciler over the same db and `Transport`, called after sync. Online-only calls go straight to `Transport`.

### 6. Rules for applying an Expense change in the domain, not twice (Worth exploring). Status: todo

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

- [ ] **Lost update across tabs.** In `device.ts:104,393-397`, `acceptedVersions` lives in memory. If another tab accepted the change, `resolveBase` takes `current.version` and can overwrite someone else's version without a Conflict.
- [x] **A retry loses `restored`.** In `push.post.ts:84-91`, `appliedBefore` returns no restored Participants, so after a lost response the Notice does not show. Done in #79: the `changes` row keeps them.
- [ ] **The Conflict screen gets the wrong list of people.** `conflict.vue:49,56` uses `trip.participants` instead of `everyone`, so a removed Participant shows as "?".
- [x] **A Manual rate rule exists only in the UI.** "Charged with a zero total" is checked only in `useManualRateErrors.ts:22`. The domain and server accept it, `conversionRate` returns `null`, and the Expense drops out of balances without a word. A Manual rate in the Expense's own currency is likewise stripped only by the UI. Done in #82 (the domain refuses both) and #83 (`useManualRateErrors` is gone).
- [ ] **The Web Push payload is not validated.** `service-worker/sw.ts:35` casts `as PushMessage` even though `pushMessageSchema` exists. The payload has no schema version, and `notification.ts` has a third amount formatter.
- [ ] **Rename the domain type `TripSnapshot`.** The glossary says "Avoid: snapshot". It is used in `PullResponse` and on the client.
- [ ] **"Notice" is not in the glossary.** It covers in-app messages, such as "Participant restored" or a rejected change.
- [ ] **"Push" means two things:** sync push and Web Push. Neither is in `GLOSSARY.md`, and neither are "Notice", "Recently deleted" or "History". `TripSnapshot` clashes with "Avoid: snapshot".
- [ ] **Fire-and-forget calls.** `void notifyAffected(…)` and `void deliver(…)` run without `event.waitUntil`. That is fine on Node and fragile on serverless.
- [ ] **`tools/tricount-import`** duplicates token generation and `hashTripToken`, and copies the schema. After #73, either delete it or share the hash.
- [ ] **The domain interface is wide.** About 19 exports of `packages/domain` are unused outside the package (`changeResultSchema`, `syncChangeSchema`, `tripSnapshotSchema`, `lineItemSchema`, `parseAmount`, `localDay`, …).
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
- [ ] **S2. One malformed change blocks the whole Trip's sync, with no message** (system H2).
  - **Server:** the sync push validates the whole body and answers 400 for all of it.
  - **Device:** queuing a change parses nothing, the shape is guarded only by forms, sync swallows the error, and the outbox resends the same first 100 changes forever. The user's only way out is "Forget anyway", which loses data.
  - **Fix:** validate with the wire schema when a change is queued. The server parses each change on its own and answers only the bad one `rejected: ['malformed']`, so it goes through the existing "not synced" flow.
  - **Overlap:** #78 (Trip sync module) is where per-change parsing on the server belongs. The device side is a missing seam, a candidate for a grilling.
- [ ] **S3. Blind SSRF through a push subscription** (security M1, system L4).
  - **The hole:** the subscription endpoint only checks for `https:`, and delivering a Notification follows redirects, so a request can reach `http://` addresses on the internal network. A Trip can be created anonymously, there is no cap on subscriptions, and the 404/410 pruning leaks one bit through `reachable`.
  - **Fix:** an allowlist of push-service hosts (FCM, Mozilla, Apple, WNS), `redirect: 'error'` on the fetch, a cap on subscriptions per Trip, and a limit on outbound concurrency.
- [ ] **S4. The rate limiter and `X-Forwarded-For`** (security M2, system M4). **Needs a human: the proxy config is not in the repo.**
  - **The problem:** nuxt-security keys its limiter on the left-most `X-Forwarded-For` entry. Depending on the proxy, the limiter is either bypassable, or every user shares one bucket. A group on one hotel Wi-Fi exhausts 150 requests in 5 minutes.
  - **Symptoms in the app:** a 429 from the limiter shows as "Reminded today", and a 409 from the schema middleware shows as "the debtor can't be notified".
  - **Fix:** set `rateLimiter.ipHeader` to a header the proxy overwrites. Reminder answers carry `{ reason }`, and the app maps on that, not on the status code. Consider exempting pulls from the limiter or raising its limit.
- [ ] **S5. History shows Revision totals in the wrong currency** (spec story 98). `history/index.vue:18` formats with the Trip currency, while the totals are in the Expense's currency, so a USD Expense reads "PLN". It is a plain bug.

### P2: before the next change to the shape of stored data

- [ ] **S6. The server's stored Expense JSON has no way to evolve** (system H3).
  - **The problem:** `jsonb().$type<ExpenseState>()` is a cast, not a parse, and Revisions keep every historical shape forever. If one bad row fails to parse, the whole pull for that Trip answers 500.
  - **Fix:** drop the `$type` cast so that skipping the parse is a type error; keep a JSON fixture per historical shape, with a test that each still parses; break changes with a SQL JSONB migration for `expenses.state`, and upgrade Revisions when they are read.
  - **Overlap:** #77 (Trip store) parses every read through the domain schemas. The fixtures, the cast and the policy for upgrading Revisions are not in #77.
- [ ] **S7. Nothing forces a sync schema version bump** (system M1).
  - **The problem:** the client parses responses strictly, so a new problem code or currency breaks older apps unless someone remembers to bump. #82 bumps by hand for exactly this reason.
  - **Fix:** a contract test that snapshots `z.toJSONSchema()` of every wire schema (push, pull, Revisions, Web Push payloads) together with `SYNC_SCHEMA_VERSION`, so CI fails until a bump or an explicit "safe" is decided.
- [ ] **S8. Frankfurter sits on the pull's critical path** (system M2, security L1).
  - **The problem:** rates are fetched one currency at a time, with a 10 s timeout each. Any Expense date and currency is allowed, so a Trip member can drive many fetches. The `retryAt` map has no bound.
  - **Fix:** answer with what the rate table holds and fill it in the background; bound the Expense instant (e.g. 1999-01-04 to a year ahead); only ask Frankfurter for currencies it covers; make `retryAt` an LRU.
  - **Overlap:** #78 puts the pull with its rates inside the Trip sync module, which is the natural place for this.
- [ ] **S9. No limits on the amount of data** (security M3).
  - **The problem:** Trips are created anonymously, with no cap on Participants, Expenses or Revisions, and the body limit is 2 MB.
  - **Fix:** per-Trip caps (100 Participants, as the existing schema already says), about 256 KB for the `/api` body, and a separate limit on creating Trips.
- [ ] **S10. Failures are silent at both ends** (system M3).
  - **Device:** every sync error is swallowed.
  - **Server:** problems only reach `console.warn`, and the app has no healthcheck.
  - **Fix:** keep the last sync error per Trip on the device and show it next to the unsynced count; add `/api/health` with a compose healthcheck; send logs somewhere they get read.

### P3: hardening and small items

- [ ] **S11. The app connects to Postgres as the superuser.** The app gets a role with read/write on the tables only; the migrator keeps the owner role.
- [ ] **S12. The CSP is weak.**
  - **The gaps:** no `default-src` or `connect-src`, and `script-src` allows `'unsafe-inline'` and `https:`.
  - **Fix:** add `default-src 'self'` and `connect-src 'self'`, then check the headers a production build actually sends.
- [ ] **S13. The Tricount share token is a CLI argument**, so it lands in shell history and the process list. Read it from stdin, a hidden prompt or an environment variable.
- [ ] **S14. The sync push parses its body before checking the token**, and a creation push tells whether a Trip id exists, which contradicts a comment in the Trip access code.
  - **Fix:** check the link first. In #78 this means the HTTP adapter must not fully parse before the module checks the link, or the comment changes.
- [ ] **S15. The pull reads its snapshot outside a transaction.** One snapshot can hold an Expense whose newly added Participant it doesn't yet show. **Overlap:** #77's single whole-Trip read can run in one `REPEATABLE READ` transaction.
- [ ] **S16. CI doesn't check that the Drizzle schema matches the migrations.** Add `drizzle-kit generate` followed by `git diff --exit-code`.
- [ ] **S17. Playwright tests only Chromium**, though the spec's top risk is iOS Safari. Add a WebKit project for the offline and sync journeys.
- [ ] **S18. Deploys build on the production host**, without tagged images, and migrations only go forward. Acceptable for now, with a backup (S1) before every deploy.
- [ ] **S19. Spec story 101 is half done.** The Revision keeps its `deviceId`, but the endpoint doesn't return it. Either use it or drop the story.
- [ ] **S20. Classifying a change** (added, changed, deleted, restored) exists twice: in the server's Notifications code and in the app's Revisions utilities.

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

Tracker: #19 is still open, and #27 is closed with unticked checkboxes although PR #57 did the work.

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

### #5: notification subscriptions (paused; resume once #75–#85 are done)

Findings that correct the original candidate:

- **The ordering is deliberate.** Reconciling subscriptions runs at the end of a sync on purpose. A Trip created offline exists on the server only after its push, so subscribing earlier gets 401. A subscription left over from a forgotten Trip has to go before a new one. If the code is split out, sync still calls it: this is an internal seam with one adapter, not a new interface.
- **The online-only calls (`revisions`, `reminderStatus`, `remind`) are not empty pass-throughs.** They keep the Trip link token away from pages, so they pass the deletion test better than the candidate claimed.

Round 1 questions, asked but not answered. Each line gives the recommendation:

- **Q1.** Extract the subscription reconciler as an internal device module named "notifications" (not "push"), over the same db and `Transport`? It holds wanted vs registered, `subscribedThisRun`, forgotten Trips, and on/off/decline/renew. Sync calls it at the end of a run, and forgetting a Trip calls it too. Nothing changes outside the device. The alternative is to leave it as it is, since #85 reshapes the device anyway. **Recommended: yes, kept small.**
- **Q2.** A Claim change and turning notifications on or off still trigger a full sync, as #85 decided, rather than a subscription-only trigger? **Recommended: yes.**
- **Q3.** The online-only calls stay on the per-Trip handle? **Recommended: yes.**
- **Q4.** Subscriptions stay as stubs in the in-process `Transport` of the device tests, as ADR 0004 allows, and the server side of subscriptions is untouched? **Recommended: yes (YAGNI).**
- **Q5.** Blocked by #85 (which is blocked by #80)? **Recommended: yes.**

Remaining candidates after #5: #6 (rules for applying an Expense change in the domain), then the small findings.

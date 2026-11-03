# Architecture review after the MVP (2026-11-03)

Findings from the post-MVP review (#45–#73), to work through one at a time. Vocabulary: module, interface, seam, adapter, depth, leverage, locality (see `.claude/skills/codebase-design`). Domain terms are from `GLOSSARY.md`.

Status: `todo`, `grilling`, `decided`, `done`, `dropped`.

## Context

- There is no production yet. The dev database can be dropped and rebuilt.
- The idea is to flatten `apps/migrator/migrations` (0000–0009) into one initial migration with the current tables before the first deploy.

## Candidates

### 1. Pull Trip sync out of the h3 handler (Strong). Status: decided (together with #2)

- **Files:** `apps/web/server/api/trips/[id]/push.post.ts`, `apps/web/test/unit/device.spec.ts` (`FakeServer`, `acceptAll`), `apps/web/test/e2e/api/trips.spec.ts`
- **Problem:** All of ADR 0002 on the server lives inside `defineEventHandler`, on the `getDb()` singleton: idempotency, Trip lock, conditional update by base version, Revisions, restoring Participants, Conflict and refusals. The only test runs through HTTP e2e and needs a Nuxt build. The client is tested against `FakeServer`, a second, hand-written version of the protocol that nothing keeps in step with the real one.
- **Direction:** One server "Trip sync" module that takes a db or transaction and handles both push and pull. The handlers become thin adapters. Protocol tests run directly against Postgres, and `device.spec` can run against the real module through an in-process `Transport`.
- **Check:** Does PGlite support `uuidv7()` (PG18)? If not, the `e2e-db` harness with Postgres 18 already exists.

### 2. One read of an Expense from the database, always through the domain schema (Strong). Status: decided (together with #1)

- **Files:** `push.post.ts:113-118`, `server/utils/reminders.ts:83-90`, `server/utils/rates.ts:36-41`, `server/utils/push.ts:211-237`, `revisions.get.ts`, `server/utils/trip-snapshot.ts:58-67` (the only path through `storedExpenseSchema.parse`)
- **Problem:** "Expense from a row" is written five times, and only the pull parses through the schema. Reminders, notifications and revisions read the raw jsonb, so zod defaults and transforms apply in only one place.
- **Note:** With no production and a fresh dev db, the pre-#61 bug (`BigInt(undefined)`) is theoretical. The structural risk stays: the next schema default will only work in the pull.
- **Direction:** One server Trip-store module for reads (Trip, Participants, live and deleted Expenses, Revisions), always through the domain schemas. Writes stay in Trip sync (#1). This fits naturally with #1.

### 3. One "Expense draft" module instead of logic in the forms (Strong). Status: grilling (together with #7)

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

### 5. Notification subscriptions as their own module next to sync (Worth exploring). Status: todo

- **Files:** `app/sync/device.ts` (704 lines), `test/unit/device.spec.ts` (646 lines)
- **Problem:** Web Push subscription reconciliation (about 120 lines, with its own state machine) is coupled to the outbox loop (`syncOnce` → `syncSubscription`). There are also three online-only pass-throughs: `revisions`, `reminderStatus` and `remind`.
- **Direction:** Make a separate reconciler over the same db and `Transport`, called after sync. Online-only calls go straight to `Transport`.

### 6. Rules for applying an Expense change in the domain, not twice (Worth exploring). Status: todo

- **Files:** `push.post.ts:205,238-247`, `app/sync/local-trip.ts:119,181,212-220` (`restoredBy`), `app/sync/device.ts:371`
- **Problem:** Two rules are written on the server and twice on the client, with a hand-copied `deleted` exception:
  - "A non-deleted accepted change restores the Participants it references."
  - "Validate with removed Participants included."
- **Direction:** The domain exports the rule ("the Trip's Participants after this Expense change"), not just its ingredients. Don't go as far as a shared reducer; the SQL update stays the arbiter.

### 7. Expense kind named in the domain (Worth exploring, small). Status: grilling (together with #3)

- **Files:** `ExpenseList.vue:74-83`, `ExpenseDetails.vue:43,72,138`, `ExpenseVersion.vue:27`, `packages/domain/src/expense.ts:132`
- **Problem:** The kind is decided ad hoc in three components. For a Receipt where the Deposit refund exceeds the goods, the list says Receipt while the details and the version say Income. `isReceipt` is not a type guard.
- **Direction:** One domain function names the kind (plain | Income | Receipt | Repayment) and narrows the type.

## Smaller findings (bugs and inconsistencies)

- [ ] **Lost update across tabs.** In `device.ts:104,393-397`, `acceptedVersions` lives in memory. If another tab accepted the change, `resolveBase` takes `current.version` and can overwrite someone else's version without a Conflict.
- [ ] **A retry loses `restored`.** In `push.post.ts:84-91`, `appliedBefore` returns no restored Participants, so after a lost response the Notice does not show.
- [ ] **The Conflict screen gets the wrong list of people.** `conflict.vue:49,56` uses `trip.participants` instead of `everyone`, so a removed Participant shows as "?".
- [ ] **A Manual rate rule exists only in the UI.** "Charged with a zero total" is checked only in `useManualRateErrors.ts:22`. The domain and server accept it, `conversionRate` returns `null`, and the Expense drops out of balances without a word. A Manual rate in the Expense's own currency is likewise stripped only by the UI.
- [ ] **The Web Push payload is not validated.** `service-worker/sw.ts:35` casts `as PushMessage` even though `pushMessageSchema` exists. The payload has no schema version, and `notification.ts` has a third amount formatter.
- [ ] **Rename the domain type `TripSnapshot`.** The glossary says "Avoid: snapshot". It is used in `PullResponse` and on the client.
- [ ] **"Notice" is not in the glossary.** It covers in-app messages, such as "Participant restored" or a rejected change.
- [ ] **"Push" means two things:** sync push and Web Push. Neither is in `GLOSSARY.md`, and neither are "Notice", "Recently deleted" or "History". `TripSnapshot` clashes with "Avoid: snapshot".
- [ ] **Fire-and-forget calls.** `void notifyAffected(…)` and `void deliver(…)` run without `event.waitUntil`. That is fine on Node and fragile on serverless.
- [ ] **`tools/tricount-import`** duplicates token generation and `hashTripToken`, and copies the schema. After #73, either delete it or share the hash.
- [ ] **The domain interface is wide.** About 19 exports of `packages/domain` are unused outside the package (`changeResultSchema`, `syncChangeSchema`, `tripSnapshotSchema`, `lineItemSchema`, `parseAmount`, `localDay`, …).
- [x] **Flatten the migrations** into one initial migration (no production yet). Done in #75: `0000_init.sql`.

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

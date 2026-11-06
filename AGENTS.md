# osi.owe.yeah

Owe Yeah ("Owe Yeah - Split expenses") is an offline-first, phone-first web app that tracks a travelling group's shared expenses and works out who owes whom. There are no accounts: the secret Trip link is the credential (ADR 0001). Devices keep whole Trips in IndexedDB and sync through the app's own protocol on top of PostgreSQL (ADR 0002).

Stack: Nuxt 4 SPA (`ssr: false`) with Nuxt UI 4 and Tailwind 4, Dexie for device storage, a Nitro server with Drizzle ORM on PostgreSQL 18, zod, and Vite+ (`vp`) for install, lint (Oxlint), format (Oxfmt) and tests (Vitest). UI journeys run in Playwright.

## Read first

- `GLOSSARY.md`: the domain language. Use its terms (Trip, Participant, Expense, Receipt, Line item, Share, Balance, Repayment, ...) in code, tests, issues, commits and UI copy, and never the words it lists under _Avoid_.
- `docs/adr/`: read the ADRs that touch the area you work in. If your change contradicts one, say so explicitly rather than silently overriding it.
- `docs/design/principles.md`: for any UI work.

## Agent skills

### Issue tracker

Specs and issues live in GitHub Issues (`RafalOsieka/osi.owe.yeah`), via the `gh` CLI; specs carry the `spec` label. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` + `docs/adr/`. See `docs/agents/domain.md`. UI work also follows `docs/design/principles.md`.

## Repository layout

A pnpm workspace (`pnpm-workspace.yaml`). Package names are `@osi/owe-yeah-*`.

- `packages/domain` (`@osi/owe-yeah-domain`): pure TypeScript domain rules, used by both the browser and the server. All money is exact fractions on `bigint` (`src/rational.ts`); nothing inside a Trip is rounded except a percent discount. No I/O, no framework imports.
- `apps/web` (`@osi/owe-yeah-web`): the Nuxt app.
  - `app/`: pages, components, composables, `sync/` (device store, outbox, pull), `service-worker/`.
  - `server/`: `api/` routes, `trip/` (store, sync, rates), `db/schema/` (Drizzle), `notifications/`, `utils/`.
  - `i18n/locales/{en,pl}.json`: the UI copy.
  - `test/{unit,nuxt,db,e2e}`: see [Testing](#testing).
- `apps/migrator` (`@osi/owe-yeah-migrator`): applies the committed SQL in `apps/migrator/migrations` and exits.
- `tools/oxlint/anti-slop`: custom Oxlint rules (frozen copy; don't edit `index.ts`, `rules/` or `shared/`).
- `tools/screenshots`: captures every screen of a running app for design reviews (`pnpm --filter @osi/owe-yeah-screenshots run capture`).
- `tools/tricount-import`: throwaway Tricount import tool, in no image.
- `deploy/osieka-dev/`: the osieka.dev instance (compose file, operator runbook, GDPR request SQL).
- `docker/`: license notice and source offer generation for the images.
- `.agents/skills`, `.claude/skills`: vendored agent skills pinned in `skills-lock.json`. Keep them byte-identical to upstream.

## Setup

```sh
vp install
cp .env.example .env                       # DATABASE_URL for the dev database
docker compose -f compose.dev.yml up -d    # PostgreSQL 18 on 127.0.0.1:5433
vp run db:migrate
vp run dev                                 # http://localhost:3000
```

`vp` downloads the Node (26) and pnpm (12) versions pinned in `package.json` `devEngines`. Use `vp`/`pnpm`, never `npm` or `npx` (they trip the Node engine check). Run workspace scripts with `vp run <script>` from the root, or `pnpm --filter <package> run <script>`.

## Commands

All from the repo root:

- `vp run lint` (Oxlint then ESLint), `vp run lint:fix`
- `vp run format`, `vp run format:check`
- `vp run type-check` (every package, the service worker and `docker/`)
- `vp run build`
- `vp run db:generate`: writes a SQL migration from `apps/web/server/db/schema` into `apps/migrator/migrations`. Needs no database.
- `vp run db:migrate`: applies the migrations to `DATABASE_URL`.

## Testing

Pick the suite by what the code touches:

| Code under test                                   | Location                    | Command                 |
| ------------------------------------------------- | --------------------------- | ----------------------- |
| Domain rules                                      | `packages/domain/test`      | `vp run test:unit`      |
| Web utilities with no Nuxt runtime                | `apps/web/test/unit`        | `vp run test:unit`      |
| Components, composables, the device store         | `apps/web/test/nuxt`        | `vp run test:nuxt`      |
| Server modules and client sync on real PostgreSQL | `apps/web/test/db`          | `vp run test:db`        |
| Migrations                                        | `apps/web/test/e2e/db`      | `vp run test:e2e:db`    |
| HTTP API against the built app                    | `apps/web/test/e2e/api`     | `vp run test:e2e:api`   |
| User journeys in a browser                        | `apps/web/test/e2e/ui`      | `vp run test:e2e:ui`    |

- Test files are `*.spec.ts`. Each `apps/web` suite is a Vitest project in `apps/web/vitest.config.ts`; the UI suite is `apps/web/playwright.config.ts`.
- Run one file: `vp test run test/money.spec.ts` in `packages/domain`, or `vp test run --project unit test/unit/avatar.spec.ts` in `apps/web`. Add `-t "<test name>"` to focus a test.
- The `db`, `e2e-db`, `e2e-api` and `ui` suites need Docker: they start their own `postgres:18-alpine` (and stub Frankfurter and the push service, `test/e2e/harness`). The UI suite also needs `vp exec playwright install chromium` in `apps/web` once.
- `test/db` gives each file a fresh, migrated database (`useMigratedDatabase`). Client sync is tested through an in-process transport over the real server module, never a fake server (ADR 0004); a Conflict comes from a real scenario, not a scripted answer.
- No module mocking (lint rule `anti-slop/no-module-mocking`). For partial test data use `fromPartial` from `@total-typescript/shoehorn`, not `as`.
- `test/unit/locale-parity.spec.ts` checks that `en.json` and `pl.json` have the same keys; `test/unit/locale-glossary.spec.ts` checks Polish copy against the glossary's _Polish avoid_ words.
- Add focused tests for the behaviour you change. No smoke tests or tests that only pin a deletion.

## Code style

- Oxfmt (`vite.config.ts` `fmt`): single quotes, semicolons, trailing commas, 100 columns, 2 spaces, LF.
- Oxlint (`vite.config.ts` `lint`) plus ESLint (`eslint.config.mjs`, Vue i18n and accessibility rules). The anti-slop rules are errors, among them:
  - No `any`, and no `unknown` or `object` parameters, returns or type aliases: give inputs a concrete type and parse them at the boundary. Dictionaries need a concrete value type too.
  - Every type assertion (except `as const`) needs a `// SAFETY: <checked invariant>` comment right before it.
  - `import type` for type-only imports.
- Let types be inferred where they can be; validate untrusted input with zod schemas (`packages/domain` holds the shared ones).
- Short doc comments above exported functions and types say what they are for. Keep them in sync with the code.
- UI copy goes through i18n in both `en.json` and `pl.json`. Polish copy uses each term's _Polish_ word from `GLOSSARY.md`, inflected as needed. If a new term's Polish word is unclear, ask.

## Server code

In `apps/web/server`, import `defineEventHandler` and the request helpers explicitly from `nuxt/server` (Nuxt 4.6+), not the implicit h3 auto-imports, so the move to Nuxt 5 / Nitro v3 stays small. Don't mix the two in one handler (it throws `NUXT_E8012`). Note `createError` there takes `status`/`statusText`, and validators accept zod schemas directly.

## Database

Every UUID primary key in `apps/web/server/db/schema` gets ``.default(sql`uuidv7()`)`` (Postgres 18), even when the client always sends the id: ids are client-generated UUIDv7s (ADR 0002), and the default covers inserts that omit them.

A table that holds a Trip's data keeps the Trip's id in `trip_id`, referencing `trips` with `onDelete: 'cascade'`, and gets a key in `deploy/osieka-dev/requests/export.sql`. The operator's erasure and access steps rely on both (`erase.sql` refuses to run without the cascade).

Migrations are generated by `vp run db:generate`, never written by hand, and stay forward-only (ADR 0005). Don't edit a migration that is already on `main`.

## Build and deployment

- `Dockerfile` builds `runtime` (default target, the Nitro server) and `migrator`. Both final images hold only Node: no package manager or toolchain. `.dockerignore` is an allowlist, so a new folder the build needs must be added there.
- CI (`.github/workflows/ci.yml`) runs lint, format, type-check, unit, nuxt, build and image checks, then the db, api and ui suites. On `main` it publishes to GHCR and commits a digest-pinned compose file to the `deploy` branch, which the test host polls (ADR 0005).
- Never push to or edit the `deploy` branch, and don't touch the GHCR packages or any running environment.
- The repo is public: don't commit private infrastructure details. Describe the host only generically ("self-hosted Docker host").

## Commits and pull requests

- Conventional Commits with a scope, e.g. `fix(web): ...`, `feat(deploy): ...`, `refactor(server): ...`, `docs(glossary): ...`, `chore(deps): ...`. The subject states the user-visible outcome in plain words, using glossary terms (`fix(web): a new Expense in a currency the Trip hasn't used shows the automatic rate`).
- PR titles follow the same format; `.github/workflows/pr-title.yml` checks them.
- Branches: `<type>/<issue>-<slug>` with the commit type (`fix/165-contributor-row-share`), or `<type>/<slug>` without an issue; `research/<topic>` and `prototype/<topic>` for exploration.
- Rebase on the latest `main` before opening a PR. Keep the description short: the problem first, then how it is solved.

## Before pushing

After the last rebase and right before every push, run `vp run format` from the repo root and commit whatever it changes, then `vp run format:check`. Formatting only the files you touched misses files a rebase brought in, and CI's `format` job fails on any unformatted file in the repo, docs included.

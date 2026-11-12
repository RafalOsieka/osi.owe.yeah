<div align="center">

<img src="apps/web/public/icon.svg" alt="Owe Yeah icon" width="96" height="96">

# Owe Yeah - Split expenses

**Keep track of shared expenses and see who owes whom, on trips, weekends away, or whenever a group shares costs.**

[![PR CI](https://github.com/RafalOsieka/osi.owe.yeah/actions/workflows/ci.yml/badge.svg)](https://github.com/RafalOsieka/osi.owe.yeah/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%5E26.13-339933?logo=node.js&logoColor=white)
![Nuxt](https://img.shields.io/badge/Nuxt-4-00DC82?logo=nuxt&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-4169E1?logo=postgresql&logoColor=white)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[Features](#features) • [Getting started](#getting-started) • [Development](#development) • [Project structure](#project-structure) • [Deployment](#deployment) • [Documentation](#documentation)

</div>

Owe Yeah is a phone-first web app for a group of people travelling together. Everyone records what they paid and who it was for, and the app works out each person's Balance and the fewest Repayments that settle the Trip. There are no accounts: whoever has the Trip link can join, and the app keeps working offline.

> [!NOTE]
> Owe Yeah is in active development. The core flow works end to end and runs in a test environment, but features and data may still change.

## Features

- **No sign-up.** A Trip is shared by its secret link or QR code. Each person picks which Participant they are on their device.
- **Expenses your way.** Enter a single amount, or itemise a Receipt line by line, split Even, by Units or by exact Amounts, with discounts, Deposits and Deposit refunds.
- **Several payers.** Contributions such as a cash tip sit next to the Main payer, and money received comes in as Income.
- **Any currency.** Foreign Expenses convert to the Trip currency at the day's rate, looked up automatically, or at a Manual rate you type in.
- **Settle up with fewer transfers.** Balances and Suggested Repayments update as you go, then you record the Repayments you made.
- **Nothing lost.** Every edit adds a Revision you can browse, and deleted Expenses can be restored.
- **Offline first.** Changes queue on the device and sync when it is back online. Two edits to one Expense surface as a Conflict, and you pick which version stays.
- **Installable.** A PWA with push notifications for new activity and Reminders to settle up.
- **Exact money.** Amounts are computed on exact fractions, so sums add up to the cent.
- **English and Polish**, in light and dark mode.

The capitalised words have precise meanings in this project. [`GLOSSARY.md`](GLOSSARY.md) defines each one.

## Getting started

### Prerequisites

- [Vite+](https://viteplus.dev) (`vp`). It downloads the Node and pnpm versions pinned in `package.json` `devEngines` (Node 26, pnpm 12).
- [Docker](https://www.docker.com/) for the dev database and the database, API and UI test suites.

### Run it locally

```sh
vp install
cp .env.example .env                       # DATABASE_URL points at the dev database
docker compose -f compose.dev.yml up -d    # dev PostgreSQL 18 on 127.0.0.1:5433
vp run db:migrate                          # apply the committed migrations
vp run dev                                 # web app on http://localhost:3000
```

> [!TIP]
> When the committed migrations are rewritten rather than added to, an existing dev database no longer migrates. Rebuild it with `docker compose -f compose.dev.yml down -v` (this deletes the dev database), then `up -d` and `vp run db:migrate` again.

## Development

Run everything from the repo root:

| Command               | What it does                                                          |
| --------------------- | --------------------------------------------------------------------- |
| `vp run dev`          | Start the web app with hot reload on port 3000                        |
| `vp run build`        | Build the web app (Nitro server plus SPA)                             |
| `vp run lint`         | Oxlint, including the project's own rules, then ESLint                |
| `vp run format`       | Format with Oxfmt (`vp run format:check` only checks)                 |
| `vp run type-check`   | Type-check every package                                              |
| `vp run test:unit`    | Unit tests: domain rules, web utilities, migrator, tools              |
| `vp run test:nuxt`    | Web component and composable tests in a Nuxt environment              |
| `vp run test:db`      | Server modules, each test file on a fresh, migrated database (Docker) |
| `vp run test:e2e:db`  | Migration tests against PostgreSQL (Docker)                           |
| `vp run test:e2e:api` | API tests against the built app (Docker)                              |
| `vp run test:e2e:ui`  | Playwright user journeys (Docker, plus a browser, see below)          |
| `vp run db:generate`  | Write a SQL migration from the Drizzle schema                         |
| `vp run db:migrate`   | Apply the committed migrations to `DATABASE_URL`                      |

The Docker-backed suites start their own `postgres:18-alpine` container, so they don't touch the dev database. The UI suite needs Chromium once: `vp exec playwright install chromium` in `apps/web`.

## Project structure

A pnpm workspace:

| Path                     | Package                     | Purpose                                                                                  |
| ------------------------ | --------------------------- | ---------------------------------------------------------------------------------------- |
| `apps/web`               | `@osi/owe-yeah-web`         | Nuxt 4 SPA with Nuxt UI, offline storage in IndexedDB, and the Nitro server with its API |
| `apps/migrator`          | `@osi/owe-yeah-migrator`    | One-shot step that applies the SQL migrations in `apps/migrator/migrations` and exits    |
| `packages/domain`        | `@osi/owe-yeah-domain`      | Pure TypeScript domain rules on exact rationals, shared by the browser and the server    |
| `tools/oxlint/anti-slop` |                             | Custom Oxlint rules                                                                      |
| `tools/screenshots`      | `@osi/owe-yeah-screenshots` | Seeds Trips into a running app and captures every screen for design reviews              |

## Deployment

The `Dockerfile` builds two images:

- `runtime` (the default target): the Nitro server for the SPA and the API.
- `migrator`: applies the migrations and exits. Run it before the app.

```sh
docker build --target runtime  -t owe-yeah .
docker build --target migrator -t owe-yeah-migrator .
```

The osieka.dev instance runs both from GHCR behind Cloudflare Tunnel, pinned by digest on a `deploy` branch that the host polls ([ADR 0005](docs/adr/0005-environments-pull-digest-pinned-images-from-git.md)). [`deploy/osieka-dev/`](deploy/osieka-dev/README.md) holds its compose file and how it is set up and operated. To run your own instance, copy and adapt it.

> [!IMPORTANT]
> The rate limiter, and the limit of 10 new Trips an hour per client, key clients by the `CF-Connecting-IP` header, which Cloudflare sets to the real client IP. They never read `X-Forwarded-For`, which a client can forge. Without Cloudflare in front, every client shares one limit for the whole app. A proxy of your own can set `CF-Connecting-IP` to the client address it sees (nginx: `proxy_set_header CF-Connecting-IP $remote_addr;`), as long as it overwrites any value the client sent.

Both images carry the notices their contents' licenses ask for in `/app/notices`: the repo's `LICENSE`, `THIRD-PARTY-NOTICES.md` for the bundled npm packages, and `SOURCE-OFFER.md` for the Alpine packages (built by `docker/`). The offer is osieka.dev's, so replace it before publishing images of your own. The app serves its browser bundle's licenses at `/licenses.txt`.

## Documentation

- [`GLOSSARY.md`](GLOSSARY.md): the domain language, with the Polish word for each term.
- [`docs/adr/`](docs/adr/): architecture decisions, such as the Trip link as the credential and the offline sync protocol.
- [`docs/design/principles.md`](docs/design/principles.md): the rules the UI's look and layout follow.
- [`deploy/osieka-dev/README.md`](deploy/osieka-dev/README.md): running and operating an instance.
- [`AGENTS.md`](AGENTS.md): instructions for coding agents working in this repo.

## Naming

- **Full app name:** Owe Yeah - Split expenses
- **Codename:** `osi.owe.yeah`

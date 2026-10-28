# Owe Yeah - Split expenses

Keep track of shared expenses and see who owes whom — on trips, weekends away, or whenever a group shares costs.

## The idea

Owe Yeah will help groups record who paid for what, split costs between participants, and work out how to settle up. The goal is to make shared expenses easy to follow, without complicated spreadsheets or mental arithmetic.

## Planned essentials

- Organize shared expenses by trip or group.
- Record payments and who shares each expense.
- See each person's balance and who owes whom.
- Keep track of repayments as the group settles up.

## Project status

> [!NOTE]
> Owe Yeah is at the concept stage. No application is available yet; features and implementation details will evolve as development begins.

## Development

pnpm workspace on [Vite+](https://viteplus.dev) (`vp`); Node and pnpm versions are pinned in `package.json` `devEngines`.

```sh
vp install
vp run dev           # web app on http://localhost:3000
vp run build
vp run lint          # Oxlint + ESLint
vp run format:check  # Oxfmt (`vp run format` to fix)
vp run type-check
vp run test:unit
vp run test:nuxt     # web component tests
vp run test:e2e:db   # database tests; needs Docker (starts postgres:18-alpine)
vp run test:e2e:api  # API tests against the built app; needs Docker
vp run test:e2e:ui   # Playwright journeys; needs Docker and `vp exec playwright install chromium` in apps/web
vp run db:generate   # write a SQL migration from the Drizzle schema
vp run db:migrate    # apply committed migrations to DATABASE_URL (see .env.example)
```

- `apps/web` (`@osi/owe-yeah-web`): Nuxt SPA with Nuxt UI, `en`/`pl` i18n and dark mode. Its server holds the Drizzle schema (`server/db/schema`) for PostgreSQL 18.
- `apps/migrator` (`@osi/owe-yeah-migrator`): one-shot step that applies the committed SQL migrations in `apps/migrator/migrations` and exits. `vp run build` bundles it for the migrator image.
- `packages/domain` (`@osi/owe-yeah-domain`): pure TypeScript domain rules on exact rationals.
- `tools/oxlint/anti-slop`: custom Oxlint rules, frozen copy from `osi.time.tracker`.

## Deployment

`Dockerfile` builds two images: `runtime` (the default target, the Nitro server for the SPA and API) and `migrator`. `compose.prod.yaml` runs `db` (PostgreSQL 18), `migrate` (runs to completion before `app` starts) and `app`, published on `127.0.0.1:3000` for the existing reverse proxy, which terminates HTTPS.

```sh
cp .env.example .env   # fill in POSTGRES_PASSWORD
docker compose -f compose.prod.yaml up -d --build
```

The rate limiter (nuxt-security) keys clients by the first `X-Forwarded-For` value, falling back to the socket address. The reverse proxy must therefore **overwrite** `X-Forwarded-For` with the real client IP (nginx: `proxy_set_header X-Forwarded-For $remote_addr;`). Without the header, every user shares the proxy's limit; if the proxy appends to a client-sent header, clients can spoof their way past the limit.

## Naming

- **Full app name:** Owe Yeah - Split expenses
- **Codename:** `osi.owe.yeah`

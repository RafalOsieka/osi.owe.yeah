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
cp .env.example .env                       # DATABASE_URL points at the dev database
docker compose -f compose.dev.yml up -d    # dev PostgreSQL on 127.0.0.1:5433
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

When the committed migrations are rewritten rather than added to (as when they were flattened into `0000_init`), an existing dev database no longer migrates. Rebuild it:

```sh
docker compose -f compose.dev.yml down -v   # deletes the dev database
docker compose -f compose.dev.yml up -d
vp run db:migrate
```

- `apps/web` (`@osi/owe-yeah-web`): Nuxt SPA with Nuxt UI, `en`/`pl` i18n and dark mode. Its server holds the Drizzle schema (`server/db/schema`) for PostgreSQL 18.
- `apps/migrator` (`@osi/owe-yeah-migrator`): one-shot step that applies the committed SQL migrations in `apps/migrator/migrations` and exits. `vp run build` bundles it for the migrator image.
- `packages/domain` (`@osi/owe-yeah-domain`): pure TypeScript domain rules on exact rationals.
- `tools/oxlint/anti-slop`: custom Oxlint rules, frozen copy from `osi.time.tracker`.
- `tools/tricount-import` (`@osi/owe-yeah-tricount-import`): throwaway admin tool that moves each Tricount into a new Trip once, run from the operator's machine with an explicit `DATABASE_URL`. It is in no image, and it is deleted after the migration (with its workspace and root-script entries). Usage:

  ```sh
  DATABASE_URL=… pnpm --filter @osi/owe-yeah-tricount-import run import <share link> --zone Europe/Warsaw --origin https://<app>
  ```

  Each fetch saves the response, without the share token, to `tools/tricount-import/responses/` (git-ignored); `--from-file <file>` imports a saved one instead.

## Deployment

`Dockerfile` builds two images: `runtime` (the default target, the Nitro server for the SPA and API) and `migrator`. `compose.prod.yaml` runs `db` (PostgreSQL 18), `migrate` (runs to completion before `app` starts) and `app`, published on `127.0.0.1:3000` for the existing reverse proxy, which terminates HTTPS.

```sh
cp .env.example .env   # fill in POSTGRES_PASSWORD, and the VAPID keys for push notifications
docker compose -f compose.prod.yaml up -d --build
```

Push notifications need a VAPID key pair. Make it once, on any machine with the repo installed, and put the printed keys into `.env` as `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`, with a contact for the push services as `VAPID_SUBJECT` (e.g. `mailto:you@example.com`):

```sh
pnpm --filter @osi/owe-yeah-web exec web-push generate-vapid-keys
```

Keep the pair once it is in use: a new one cuts off every subscribed device until it turns notifications on again. Without the keys the app still runs, but notifications can't be turned on.

The rate limiter (nuxt-security) keys clients by the first `X-Forwarded-For` value, falling back to the socket address. The reverse proxy must therefore **overwrite** `X-Forwarded-For` with the real client IP (nginx: `proxy_set_header X-Forwarded-For $remote_addr;`). Without the header, every user shares the proxy's limit; if the proxy appends to a client-sent header, clients can spoof their way past the limit.

## Naming

- **Full app name:** Owe Yeah - Split expenses
- **Codename:** `osi.owe.yeah`

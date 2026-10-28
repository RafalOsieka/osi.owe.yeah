# syntax=docker/dockerfile:1

# Two images come out of this file:
#   docker build .                   -> the web app (the last stage, `runtime`)
#   docker build --target migrator . -> the one-shot migrator used by the prod compose
# Both final images hold only Node and their own output: no package manager, no
# toolchain and no workspace tools (the Tricount importer never enters the build context).

# ── migrator-build ────────────────────────────────────────────────────────────
# Bundles the migrator CLI (`vp pack`) into a single file with its dependencies
# inlined. The official Vite+ image ships `vp` and resolves Node.js and pnpm from
# `devEngines`. Keep the tag in sync with the `vite-plus` catalog entry.
FROM ghcr.io/voidzero-dev/vite-plus:1.3.0 AS migrator-build
WORKDIR /app

COPY --chown=vp:vp package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=vp:vp apps/migrator/package.json apps/migrator/
RUN vp install --frozen-lockfile --ignore-scripts --filter "@osi/owe-yeah-migrator..."

COPY --chown=vp:vp apps/migrator apps/migrator
RUN vp run --filter @osi/owe-yeah-migrator build

# ── slim-node ─────────────────────────────────────────────────────────────────
# Node on the same major as `devEngines.runtime`. The official image ships npm,
# corepack and yarn; the final images need only `node`.
FROM node:24-alpine AS slim-node
RUN rm -rf /usr/local/lib/node_modules /opt/yarn-* \
  /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
  /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
ENV NODE_ENV=production

# ── migrator ──────────────────────────────────────────────────────────────────
# The bundled CLI and the committed SQL. Applies pending migrations to
# `DATABASE_URL`, then exits.
FROM slim-node AS migrator

COPY --from=migrator-build /app/apps/migrator/dist ./dist
COPY --from=migrator-build /app/apps/migrator/migrations ./migrations

USER node

CMD ["node", "dist/cli.mjs"]

# ── build ─────────────────────────────────────────────────────────────────────
FROM ghcr.io/voidzero-dev/vite-plus:1.3.0 AS build
WORKDIR /app

# Manifests first for layer caching. The image runs as the non-root `vp` user, so
# copied files must be owned by it. The web app's dev dependency on the migrator
# (the db e2e harness) puts its manifest in the filtered install.
COPY --chown=vp:vp package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=vp:vp apps/web/package.json apps/web/
COPY --chown=vp:vp apps/migrator/package.json apps/migrator/

# Skip postinstall (`nuxt prepare`): the source isn't copied yet.
RUN vp install --frozen-lockfile --ignore-scripts --filter "@osi/owe-yeah-web..."

# The build context is an allowlist, see .dockerignore.
COPY --chown=vp:vp . .
RUN vp exec --filter @osi/owe-yeah-web nuxt prepare \
  && vp run --filter @osi/owe-yeah-web build

# ── runtime ───────────────────────────────────────────────────────────────────
# The Nitro output is self-contained (no native modules). Serves the SPA and the
# API on port 3000; `DATABASE_URL` is supplied at container start, never baked in.
FROM slim-node AS runtime

COPY --from=build /app/apps/web/.output .

USER node

EXPOSE 3000

CMD ["node", "server/index.mjs"]

# syntax=docker/dockerfile:1

# Two images come out of this file:
#   docker build .                   -> the web app (the last stage, `runtime`)
#   docker build --target migrator . -> the one-shot migrator the deployed compose runs before the app
# Both final images hold only Node and their own output: no package manager, no
# toolchain and no workspace tools.
# Both carry their license notices in /app/notices: the repo's LICENSE, the npm packages'
# THIRD-PARTY-NOTICES.md and the Alpine packages' SOURCE-OFFER.md (see docker/).

# ── migrator-build ────────────────────────────────────────────────────────────
# Bundles the migrator CLI (`vp pack`) into a single file with its dependencies
# inlined. The official Vite+ image ships `vp` and resolves Node.js and pnpm from
# `devEngines`. Keep the tag in sync with the `vite-plus` catalog entry.
FROM ghcr.io/voidzero-dev/vite-plus:1.5.0 AS migrator-build
WORKDIR /app

COPY --chown=vp:vp package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=vp:vp apps/migrator/package.json apps/migrator/
RUN vp install --frozen-lockfile --ignore-scripts --filter "@osi/owe-yeah-migrator..."

COPY --chown=vp:vp apps/migrator apps/migrator
COPY --chown=vp:vp docker docker
RUN vp run --filter @osi/owe-yeah-migrator build \
  && node docker/third-party-notices.ts THIRD-PARTY-NOTICES.md apps/migrator/dist

# ── slim-node ─────────────────────────────────────────────────────────────────
# Node on the same major as `devEngines.runtime`. The official image ships npm,
# corepack and yarn; the final images need only `node`.
FROM node:26-alpine AS slim-node
RUN rm -rf /usr/local/lib/node_modules /opt/yarn-* \
  /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
  /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
ENV NODE_ENV=production

# Nothing is installed after this stage, so the offer lists every Alpine package either
# image holds. Node's own license stays at /usr/local/LICENSE.
COPY LICENSE notices/
RUN --mount=type=bind,source=docker/source-offer.sh,target=/tmp/source-offer.sh \
  sh /tmp/source-offer.sh > notices/SOURCE-OFFER.md

# `source` links the GHCR packages to the repo.
LABEL org.opencontainers.image.source="https://github.com/RafalOsieka/osi.owe.yeah" \
  org.opencontainers.image.licenses="MIT"

# ── migrator ──────────────────────────────────────────────────────────────────
# The bundled CLI and the committed SQL. Applies pending migrations to
# `DATABASE_URL`, then exits.
FROM slim-node AS migrator

COPY --from=migrator-build /app/apps/migrator/dist ./dist
COPY --from=migrator-build /app/apps/migrator/migrations ./migrations
COPY --from=migrator-build /app/THIRD-PARTY-NOTICES.md notices/

ARG COMMIT_SHA=dev
LABEL org.opencontainers.image.description="Owe Yeah's migrator: applies the committed SQL migrations to DATABASE_URL, then exits" \
  org.opencontainers.image.revision=$COMMIT_SHA

USER node

CMD ["node", "dist/cli.mjs"]

# ── web-build ─────────────────────────────────────────────────────────────────
FROM ghcr.io/voidzero-dev/vite-plus:1.5.0 AS web-build
WORKDIR /app

# Manifests first for layer caching. The image runs as the non-root `vp` user, so
# copied files must be owned by it. The web app depends on the domain package, and its
# dev dependency on the migrator (the e2e harness) puts that manifest in the install too.
COPY --chown=vp:vp package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=vp:vp apps/web/package.json apps/web/
COPY --chown=vp:vp apps/migrator/package.json apps/migrator/
COPY --chown=vp:vp packages/domain/package.json packages/domain/

# Skip postinstall (`nuxt prepare`): the source isn't copied yet.
RUN vp install --frozen-lockfile --ignore-scripts --filter "@osi/owe-yeah-web..."

# The build context is an allowlist, see .dockerignore.
COPY --chown=vp:vp . .
RUN vp exec --filter @osi/owe-yeah-web nuxt prepare \
  && vp run --filter @osi/owe-yeah-web build \
  && node docker/third-party-notices.ts THIRD-PARTY-NOTICES.md apps/web/.output/server

# ── runtime ───────────────────────────────────────────────────────────────────
# The Nitro output is self-contained (no native modules). Serves the SPA and the
# API on port 3000; `DATABASE_URL` is supplied at container start, never baked in.
FROM slim-node AS runtime

COPY --from=web-build /app/apps/web/.output .
COPY --from=web-build /app/THIRD-PARTY-NOTICES.md notices/

# The Git commit `/healthz` reports (`docker build --build-arg COMMIT_SHA=<sha>`); `dev`
# without one. Declared after the copy, so a new commit reuses the cached build.
ARG COMMIT_SHA=dev
ENV NUXT_COMMIT_SHA=$COMMIT_SHA
LABEL org.opencontainers.image.description="Owe Yeah: shared Trip expenses, worked out exactly, even offline" \
  org.opencontainers.image.revision=$COMMIT_SHA

USER node

EXPOSE 3000

CMD ["node", "server/index.mjs"]

# Environments pull digest-pinned images named in Git

Owe Yeah runs on a self-hosted Docker host that accepts no inbound connections, behind Cloudflare Tunnel. CI builds the `runtime` and `migrator` images once, on `main` after every other job is green, pushes them to GHCR tagged by commit SHA, and commits a compose file with both images pinned by **digest** to a dedicated `deploy` branch (`test/compose.yaml` for the test environment). The host runs that file as a stack that polls the branch; nothing reaches into the host. Later environments are copies: their own file on `deploy`, their own tunnel and their own secrets, fed the same digests, so what was tested is what is promoted.

We chose this over a self-hosted Actions runner, which GitHub advises against for public repositories (a fork's pull request can target its label), over registry-polling updaters such as Watchtower, which follow a moving tag and don't let the migrator gate the app, and over a deploy webhook or SSH through the tunnel, which would put a credential that reaches the host into GitHub. Pulling keeps every secret on the host and leaves Git as the record of what runs.

## Consequences

- `main` stays protected: CI commits only to `deploy`, one commit per deploy, so that branch's history is the deploy log. Rolling back is reverting its latest commit; fixing forward is the default.
- CI can't see a deploy land, so a `verify-deploy` job polls the environment's public `/healthz` until it reports the new commit.
- The migrator is a one-shot service the app depends on. Compose stops the old app before the migrator runs, so a deploy is down for the length of the migration, and a failed migration keeps the app down until the next good deploy. Accepted for test, whose data may be wiped; prod revisits it.
- Migrations stay forward-only. An older build after a rollback runs against the newer schema; if that breaks on test, its database is wiped.
- Each environment has its own remotely-managed tunnel, whose `cloudflared` runs in the same compose project and reaches the app over the compose network, so the app publishes no port. Only Cloudflare reaches the app, which is what lets the rate limiter trust `CF-Connecting-IP`.
- The GHCR packages are public, so the host needs no registry credential. They go public only once the images carry their license notices.
- `deploy/osieka-dev/` holds this instance's compose template and operator runbook, and replaces `compose.prod.yaml`. Anyone else running Owe Yeah copies and adapts it.
- Promoting to prod adds a second file on `deploy`, changed only by a manual workflow behind a GitHub Environment with required reviewers.

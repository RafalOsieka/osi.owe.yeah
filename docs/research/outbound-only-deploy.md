# Getting a GHCR image onto a host with no inbound connections

Research for [#90](https://github.com/RafalOsieka/osi.owe.yeah/issues/90), part of the map [#88](https://github.com/RafalOsieka/osi.owe.yeah/issues/88). Checked 2026-11-03 against official docs and source repositories.

**Question.** GitHub Actions builds two images (`runtime`, `migrator`) and pushes them to GHCR. How does a new version reach a self-hosted Docker host, reachable only by outbound connections (apart from a Cloudflare Tunnel), and start there with the migrator run to completion first? The answer should be repeatable for a later prod environment, promoted by digest.

## Short answer

Make the host **pull**, and make Git the record of what should run. CI pushes the images, then records the digests it built in the repository: a small env file per environment, outside `main`. On the host, a scheduled job (or a GitOps agent) reads that file and runs `docker compose pull && docker compose up -d`. Compose already gates the app on the migrator (`service_completed_successfully`). Nothing reaches into the host, nothing on the host runs code from pull requests, and GitHub holds no credential that can touch the host. For prod you add a second file, changed only by a workflow behind a GitHub Environment with required reviewers.

A webhook through the tunnel, protected by a Cloudflare Access service token, can be added later to cut the polling delay. It is optional, not part of the base design. A self-hosted GitHub runner on the host is the option to avoid for this public repository.

## Facts the options rest on

- **Compose already provides the migrator gate.** `depends_on: condition: service_completed_successfully` "specifies that a dependency is expected to run to successful completion before starting a dependent service" ([Compose services reference](https://docs.docker.com/reference/compose-file/services/)). `compose.prod.yaml` uses it. Any option that ends in `docker compose up` on the whole project keeps the gate. An option that recreates containers one at a time does not.
- **Compose accepts a digest in `image:`.** The format is `[<registry>/][<project>/]<image>[:<tag>|@<digest>]`, for example `redis@sha256:…` ([same page](https://docs.docker.com/reference/compose-file/services/)). GHCR supports pulling by digest: `ghcr.io/NAMESPACE/IMAGE_NAME@sha256:<digest>` ([Working with the Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)).
- **Public GHCR images need no credential to pull.** "You can also access public container images anonymously" ([same page](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)). A package starts private when first published ("When you first publish a package, the default visibility is private"), so it has to be made public once. After that, the host needs no GitHub token at all.
- **Tags made from commit SHAs have no order.** Tools that follow tags either watch one moving tag for a new digest (Watchtower) or compare versions (WUD). Neither can tell which of two SHA tags is newer. Something has to tell the host which digest to run, and only that keeps the pinning.

## Options

### 1. Self-hosted GitHub Actions runner on the host

**How it works.** The runner only makes outbound HTTPS connections ("The host machine must be able to make outbound HTTPS connections over port 443", to `github.com`, `api.github.com`, `*.actions.githubusercontent.com`, `ghcr.io` and others; [Self-hosted runners reference](https://docs.github.com/en/actions/reference/runners/self-hosted-runners)). It therefore fits the no-inbound constraint. A deploy job (`needs:` the green CI jobs, `runs-on:` the runner's label, `environment: test`) would run `docker compose pull && up -d` with the digests it just pushed.

**Security for a public repo.** GitHub's own guidance is clear:

- "self-hosted runners should almost never be used for public repositories on GitHub", because "any user can open pull requests against the repository and compromise the environment" ([Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)).
- Self-hosted runners "do not have guarantees around running in ephemeral clean virtual machines" and "can be persistently compromised by untrusted code in a workflow". A compromise can include "gaining access to secrets", and environment secrets behind required reviewers "still run on the same runner" ([same page](https://docs.github.com/en/actions/reference/security/secure-use)).
- A pull request from a fork runs the workflow files from the PR itself. Restricting *our* deploy workflow to `push` on `main`, or to an Environment, therefore does not stop a PR from adding its own job with `runs-on: <our label>`. Environments restrict which branches may use their secrets ("Selected branches and tags"; [Deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)), not which jobs may land on a runner.
- The only gate on fork PRs is the approval setting. The default is "all first-time contributors require approval to run workflows". The strictest option is "Require approval for all external contributors". GitHub still warns: "If you are using self-hosted runners, potentially malicious user-controlled workflow code will execute automatically" once approved or bypassed ([Managing GitHub Actions settings for a repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)). One careless approval is enough.
- Runner groups, which can limit runners to selected repositories and workflows, are an organization feature. By default "only private repositories can access runners in a runner group" ([Managing access to self-hosted runners](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/manage-access)). This repository belongs to a personal account, so the runner would be registered on the repository, with no group to restrict it.
- To deploy, the runner needs the Docker socket, which is root-equivalent on the host. Every job that lands on it can then see the host, its other containers and its network.

**Pinning.** Good: the job knows the digests it just pushed. **Migrator gate:** kept (compose). **Prod:** a second runner, or a second label, behind an Environment with required reviewers. That adds a second machine with the same exposure.

**Verdict.** It works and is convenient, but this is exactly the setup GitHub tells public repositories not to use. Rejected.

### 2. Pull-based image updaters (Watchtower and successors)

**Watchtower is dead.** `containrrr/watchtower` "was archived by the owner on Dec 17, 2025", and its README says "This project is no longer maintained" ([repo](https://github.com/containrrr/watchtower)). The maintainers name no successor. They note "There are a few forks out there", that they cannot vouch for them, and that "A few of the active forks I've looked at are full of AI slop" ([discussion #2135](https://github.com/containrrr/watchtower/discussions/2135)).

**Maintained alternatives** (checked 2026-11-03 via the GitHub API):

| Project | State | What it does |
|---|---|---|
| [`nicholas-fedor/watchtower`](https://github.com/nicholas-fedor/watchtower) | active fork, release v1.23.2 on 2026-10-22 | Watchtower behaviour plus an HTTP API, lifecycle hooks and Git monitoring |
| [`getwud/wud`](https://github.com/getwud/wud) (What's Up Docker) | active, 9.7.0 on 2026-10-31 | Watches tags; can trigger a Docker Compose update |
| [`crazy-max/diun`](https://github.com/crazy-max/diun) | active, v4.33.1 on 2026-10-24 | Notifies only; does not update |

**How they fit this project.**

- **Pinning breaks.** By default Watchtower's "staleness signal is a registry digest change" on the tag a container already runs ([update behaviour docs](https://github.com/nicholas-fedor/watchtower/blob/main/docs/configuration/update-behavior/index.md)). The host must therefore run a moving tag (for example `:test`), and *what runs* lives in the registry, not in Git. Moving prod forward means re-tagging in GHCR. WUD's compose trigger "recreates containers managed by Docker Compose by pulling the latest images" ([WUD docs](https://github.com/getwud/wud/blob/main/website/docs/configuration/triggers/docker-compose/README.md)), but deciding which tag is "latest" needs version-like tags, which commit SHAs are not.
- **The migrator gate is not guaranteed.** Watchtower recreates containers one by one, ordered by detected dependencies, including the `com.docker.compose.depends_on` label ([linked containers](https://github.com/nicholas-fedor/watchtower/blob/main/docs/advanced-features/linked-containers/index.md)). That ordering is about which container starts first, not about one finishing successfully. The migrator is an *exited* container, which Watchtower ignores unless `--include-stopped` and `--revive-stopped` are set ([container selection](https://github.com/nicholas-fedor/watchtower/blob/main/docs/configuration/container-selection/index.md)). Lifecycle hooks run inside the container being updated and "cannot run" if it is not running ([lifecycle hooks](https://github.com/nicholas-fedor/watchtower/blob/main/docs/advanced-features/lifecycle-hooks/index.md)). The fork's Git monitoring can apply a whole Compose project from a local path, but that path *builds* images from source on the host, which is not what we want.
- **Trigger.** Polling on a schedule, or the fork's HTTP API (`POST /v1/update?image=…` with a bearer token; [update endpoint](https://github.com/nicholas-fedor/watchtower/blob/main/docs/http-api/endpoints/update/index.md)) reached through the tunnel.

**Verdict.** Built for "keep third-party images fresh", not for "run exactly this digest, migrator first". Rejected for the app, though they stay fine for third-party images.

### 3. Container-management / GitOps tools with Git polling or webhooks

These tools keep a compose project in step with a Git repository. The pinned digests live in Git, so whatever the repository says is what runs. Updates are applied as a whole Compose project, so the migrator gate holds.

**Portainer CE (Community Edition).** Facts from the docs and from the CE source:

- **Stack webhook for Web-editor/upload stacks** (the one that takes `?tag=…` or env overrides to redeploy with a new image): "This functionality is only available in Portainer Business Edition" ([Stack webhooks](https://docs.portainer.io/user/docker/stacks/webhooks)). It is not in CE.
- **Git-based stacks** offer automatic updates by **polling** ("Periodically poll the Git repository") or by **webhook**, plus **Re-pull image** and **Force redeployment**, with no BE marker ([Add a new stack](https://docs.portainer.io/user/docker/stacks/add)). The CE source ([`portainer/portainer`](https://github.com/portainer/portainer), whose README calls itself "Portainer Community Edition") has the route `POST /stacks/webhooks/{webhookID}` with `bouncer.PublicAccess`, documented as "Webhook for triggering stack updates from git" ([handler.go](https://github.com/portainer/portainer/blob/develop/api/http/handler/stacks/handler.go), [webhook_invoke.go](https://github.com/portainer/portainer/blob/develop/api/http/handler/stacks/webhook_invoke.go)). It pulls the repository and redeploys "when git repo changed", or always when force redeployment is on ([deploy.go](https://github.com/portainer/portainer/blob/develop/api/stacks/deployments/deploy.go)). The webhook needs no login: the UUID in the URL is the only secret.
- **Conflicting marketing.** The [features page](https://www.portainer.io/features) lists "GitOps automatic updates and webhooks" and "Deploy from a Git repository" under Business Edition. The CE code and docs above show Git polling and the Git webhook in CE today. Treat that as something that can move to BE.
- **Not meant for production.** The CE README says CE "is not intended for, or supported in, business, production, or any other environment where uptime, security posture, or data integrity matter" ([README](https://github.com/portainer/portainer)). That counts against using it for "repeatable for prod".
- **Compose semantics.** CE deploys through the Docker Compose v2 library (`github.com/docker/compose/v2`, [composeplugin.go](https://github.com/portainer/portainer/blob/develop/pkg/libstack/compose/composeplugin.go)), so `service_completed_successfully` is honoured.

**doco-cd** ([`kimdre/doco-cd`](https://github.com/kimdre/doco-cd), active, v0.132.0 on 2026-11-01). A "declarative GitOps continuous delivery tool that automatically deploys and updates Docker Compose projects … using polling and webhooks". It is a single small container with notifications, pre/post-deploy scripts and SOPS support ([docs](https://doco.cd/latest/)).

**Komodo** ([`moghtech/komodo`](https://github.com/moghtech/komodo), active, v2.3.4 on 2026-10-22) is a larger build-and-deploy platform with Git-backed stacks. It is more than this project needs.

**Trigger after green CI.** CI writes the new digests into the environment's file in Git. The tool notices on its next poll, or at once if CI calls its webhook through the tunnel (see option 4). **Pinning:** digests in Git. **Prod:** a second stack or project pointing at the prod file.

**Verdict.** It fits the model well. The cost is a long-running management service with Docker-socket access. That is acceptable, but optional: option 5b does the same thing with a script.

### 4. A deploy endpoint reached through Cloudflare Tunnel from Actions (SSH or webhook)

The tunnel connector only dials out, so this still means no inbound ports. GitHub-hosted runners are on the public internet, so an endpoint published through the tunnel must be protected by **Cloudflare Access**:

- **Service tokens** let automated clients authenticate with two headers, `CF-Access-Client-Id` and `CF-Access-Client-Secret`. The policy action must be **Service Auth**, otherwise Access prompts for an identity-provider login. Tokens have a chosen duration (the example is `8760h`), can be refreshed, and the secret can be rotated with a grace period ([Service tokens](https://developers.cloudflare.com/cloudflare-one/identity/service-tokens/)). Service Auth is the action "that do[es] not require an identity provider IdP login" and uses non-identity selectors such as Service Token ([Access policies](https://developers.cloudflare.com/cloudflare-one/policies/access/)).
- **SSH through the tunnel** uses `ProxyCommand cloudflared access ssh --hostname %h`. The documented flow opens a browser for login ([SSH with cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/use-cases/ssh/ssh-cloudflared-authentication/)). For CI, `cloudflared access ssh|tcp` accepts `--service-token-id` / `--service-token-secret`, or the env vars `TUNNEL_SERVICE_TOKEN_ID` / `TUNNEL_SERVICE_TOKEN_SECRET`. These flags are not in the docs pages, only in the source ([cloudflared `access/cmd.go`](https://github.com/cloudflare/cloudflared/blob/master/cmd/cloudflared/access/cmd.go)).
- **A webhook** (a GitOps tool's redeploy URL, or a tiny deploy endpoint) gets its own hostname with a Service Auth policy. CI calls it with `curl -H "CF-Access-Client-Id: …" -H "CF-Access-Client-Secret: …"`.
- This assumes the Cloudflare Zero Trust free tier covers a handful of service tokens. The pricing pages I could fetch did not state the limits, so check the dashboard before relying on it.

**Security trade-off.** GitHub now holds a credential that reaches the host. With SSH, that is a shell. A forced command for a dedicated user narrows it, but that user needs Docker access, which is root-equivalent anyway. With a webhook, it is "redeploy what Git says", which is much narrower. Either way, a leaked GitHub secret is now a path to the host, which option 5 does not have. Secrets in `push`-on-`main` workflows are not exposed to fork PRs. The risk sits with the workflow and any action it uses.

**Pinning:** digests passed by CI (SSH) or read from Git (webhook). **Migrator gate:** kept if the remote command is `docker compose up`. **Prod:** a second Access app or token behind a GitHub Environment with required reviewers.

**Verdict.** Use a webhook only as an *accelerator* for option 3/5b, never with SSH-as-deploy. It is optional for test.

### 5. Baselines: manual, and scripted pull

**5a. Manual pull-and-restart.** Someone opens a shell on the host and edits the digests in `.env` (or runs `git pull` on the deploy file). Then they run `docker compose pull && docker compose up -d`, and Compose runs the migrator first. It is safe and needs no tooling, but someone has to remember to do it, and nothing records what is deployed.

**5b. A scheduled pull on the host (recommended).** A systemd timer or cron job on the host, every minute or few:

1. `git fetch` a read-only clone of the public repo (no credential needed). Read the environment's file with the two digests, `RUNTIME_IMAGE=ghcr.io/…@sha256:…` and `MIGRATOR_IMAGE=…`.
2. If they differ from what runs, run `docker compose pull && docker compose up -d`. Compose waits for `migrate` to complete successfully before it (re)creates `app`. If the migration fails, the new app is not started and the job exits non-zero. Whether the *old* `app` container keeps serving in that case was not verified here; try it when #91 sets up the compose file.

This is option 3 without the extra service. It needs only outbound HTTPS to GitHub and GHCR, no credentials in GitHub, and no code from PRs. The one shared input is a public file of digests.

## Comparison

| Option | Trigger after green CI | Pinning | Migrator gates app | Credential that reaches the host | Runs PR code near host | Repeat for prod |
|---|---|---|---|---|---|---|
| 1. Self-hosted runner | Deploy job `needs:` CI | Digest, from the job | Yes (compose) | Runner itself, plus Docker socket | **Yes, if a fork PR is approved or the setting is loosened** | Second runner/label + Environment; same exposure |
| 2. Watchtower-style updater | Poll / HTTP API | **Moving tag only** | **No** (per-container recreate; exited migrator ignored by default) | None (poll) / bearer token (API) | No | Re-tag in GHCR; Git no longer says what runs |
| 3. GitOps tool (Portainer CE Git stack, doco-cd, Komodo) | Poll Git, or webhook | Digest in Git | Yes (compose) | None (poll) / webhook secret | No | Second stack pointing at prod file; Portainer CE "not intended for production", BE-only bits may move |
| 4. SSH / webhook via tunnel + Access | CI calls endpoint | Digest from CI or Git | Yes, if it runs `compose up` | **Access service token in GitHub secrets** (SSH: a shell) | No | Second token/app + Environment approval |
| 5a. Manual | A person | Digest in `.env` | Yes (compose) | None | No | Same by hand |
| **5b. Scheduled pull on host** | Poll Git (~1 min) | **Digest in Git** | **Yes (compose)** | **None** | **No** | **Second file, changed only behind an Environment with required reviewers** |

## Recommendation

For test, use **5b**: images pinned by digest in a per-environment file, pulled by a scheduled job on the host and applied with `docker compose up -d`. Prod repeats it with its own file. Promotion is then "copy the test digests into the prod file", done by a `workflow_dispatch` workflow behind a GitHub Environment with required reviewers. Required reviewers are available for public repositories on all plans ([Deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)).

If the polling delay ever matters, add a webhook. Either swap the script for a GitOps tool with Git polling and a webhook (doco-cd is the lightest, maintained candidate), or give the script a trigger endpoint. Put it behind the tunnel with a Cloudflare Access **Service Auth** policy, and have CI call it with a service token. The model stays the same: Git says what runs, and Compose runs the migrator first.

Do not use a self-hosted runner (GitHub's guidance for public repos). Do not use Watchtower or similar tools for the app: they lose pinning and the migrator gate, and the original Watchtower is archived.

## Open points for later tickets

- **Where the digest file lives.** Committing to `main` from CI collides with branch protection and adds noise. A dedicated branch (for example `deploy`) or a `deploy/` path that a bot token may push to avoids that. The alternative is GitHub Deployments read through the API, but that needs a token on the host for nothing more than reading. Decide in #91.
- **GHCR visibility.** Make both packages public once after the first push. Then the host needs no registry credential.
- **Failure reporting.** With a pull model, CI cannot see whether the deploy succeeded. The host job has to report it, for example by posting a commit status or deployment status (this needs a narrow token on the host), or by notifying elsewhere. This connects to the map's "learning that a deploy failed" fog.
- **Rollback.** Reverting the digest file rolls the app back, but not the migrations. This connects to the map's rollback fog.

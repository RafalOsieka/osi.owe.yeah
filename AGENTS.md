# osi.owe.yeah

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues (`RafalOsieka/osi.owe.yeah`) via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` + `docs/adr/`. See `docs/agents/domain.md`.

## Server code

In `apps/web/server`, import `defineEventHandler` and the request helpers explicitly from `nuxt/server` (Nuxt 4.6+), not the implicit h3 auto-imports, so the move to Nuxt 5 / Nitro v3 stays small. Don't mix the two in one handler (it throws `NUXT_E8012`). Note `createError` there takes `status`/`statusText`, and validators accept zod schemas directly.

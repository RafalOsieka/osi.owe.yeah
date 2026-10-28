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
vp run lint          # Oxlint + ESLint
vp run format:check  # Oxfmt (`vp run format` to fix)
vp run type-check
vp run test:unit
```

- `packages/domain` (`@osi/owe-yeah-domain`): pure TypeScript domain rules on exact rationals.
- `tools/oxlint/anti-slop`: custom Oxlint rules, frozen copy from `osi.time.tracker`.

## Naming

- **Full app name:** Owe Yeah - Split expenses
- **Codename:** `osi.owe.yeah`

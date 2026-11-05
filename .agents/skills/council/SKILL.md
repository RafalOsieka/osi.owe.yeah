---
name: council
description: "Put the current work before a council of two delegates (Opus and GPT Sol, run through Junie) and iterate in rounds until both are satisfied: a code review, or a design review of screenshots scored against a target. Use when the user says 'council'."
metadata:
  credits:
    skill: council
    author: Theo Browne
    organisation: T3
    url: "https://github.com/t3dotgg/tstack/blob/main/skills/council/SKILL.md"
---

A **council** is two **delegates** working the same request independently: `opus` and `gpt-sol`, each at high effort, both run through the Junie CLI. If the user names other members, use those. Every member the user expects must actually sit: if one can't run, report it to the user rather than seating a substitute.

The council does one of three jobs:

- **Code review** (the usual): two axes, Standards and Spec, each scored out of 10.
- **Design review**: screenshots of the app, one axis, Design, scored out of 10 against the user's **target** (e.g. "at least 9/10 from both").
- **Anything else** (a plan, an idea): the same steps with the request and its context pointers as the brief, and no scores.

Each run lives in one **run folder** (`mktemp -d`, outside the repo): `template.md`, then one `r<N>/` per round holding that round's `changes.md`, `brief.md`, `shots/`, and each delegate's `.json`, `.log` and `.md`.

## 1. Settle the work

Before the audit, address outstanding PR comments, fix known issues, and run the relevant checks. The council reviews the work as it stands, so known fixes go in first. If the user is discarding the implementation to explore new ideas, skip fixes to code that's being replaced.

## 2. Write the brief template

Every round's brief comes from `<run>/template.md`, filled in by `scripts/brief.mjs` (step 3). Placeholders: `{{round}}`, `{{folder}}` (the round's `shots/` path) and `{{changes}}` (that round's `changes.md`). Write the template once, and add to it as the run goes on.

**Code review:** run steps 1–3 of the `code-review` skill: pin the fixed point, find the spec, gather the standards sources and the smell baseline. The template carries:

- the diff command and commit list;
- the spec, as a path or pasted in;
- the standards source files, plus the smell baseline pasted in full;
- both sub-agent briefs from `code-review` step 4, **Standards** and **Spec**, each asking for a score out of 10 for that axis.

**Design review:** the template carries:

- what the product is and who uses it;
- the bar to judge against;
- `{{folder}}`, and one line per screen saying what it shows;
- "Judge the screenshots only: read no source code."

Capture each round's set from a freshly started app, so the app's current state is what gets judged; in this repo: `pnpm --filter @osi/owe-yeah-screenshots capture <run>/r<N>/shots`. Put screens that matter in the set from round 1, especially the most complex forms. A screen added later costs a round, since scores dip while it catches up.

**Every template** also carries:

- **Rules:** read-only; write no files, not even notes or plans; **never use plan mode** (Junie's planning workflow writes `.junie/plans/` and ends with no answer).
- **Kept on purpose:** each recommendation you rejected, with its reason, marked "not to be scored down for".
- **What changed** since the last round: `{{changes}}`.
- **Reply shape:** the final message is all that is kept, so the **whole** review goes in it. For a code review, a `## Standards` and a `## Spec` section, each ending in `Score: N/10`. For a design review, per-screen findings, then only what still keeps it below the target, then `Score: N/10`.

The template is done when a delegate with no other context could run the whole review from a brief filled from it.

## 3. Convene

Fill the round's brief, then start both delegates in parallel, in the background, each with its own output paths:

```bash
node .claude/skills/council/scripts/brief.mjs "$RUN" 1        # prints $RUN/r1/brief.md
W=$(cygpath -w "$RUN/r1")
cat "$RUN/r1/brief.md" | env -u PSModulePath cmd //c "junie --skip-update-check --model=opus --effort=high --output-format=json --json-output-file=$W\\opus.json" > "$RUN/r1/opus.log" 2>&1 &
cat "$RUN/r1/brief.md" | env -u PSModulePath cmd //c "junie --skip-update-check --model=gpt-sol --effort=high --output-format=json --json-output-file=$W\\sol.json" > "$RUN/r1/sol.log" 2>&1 &
```

Write one explicit line per delegate: a loop variable inside the `cmd //c "…"` string can reach Junie unexpanded, and both delegates then write the same JSON file. Three Junie quirks shape the command:

- The `junie` launcher spawns Windows PowerShell 5, which fails (`Could not create a private restart directory`) under PowerShell 7's `PSModulePath`. Unsetting it lets PowerShell 5 rebuild its own.
- Junie needs stdin to be a pipe; with no pipe it fails with `Incorrect function` (`Niepoprawna funkcja`). Piping the brief also keeps it off the command line.
- `--json-output-file` takes a Windows path.

A round takes minutes. Wait for both JSON files, then run `scripts/result.mjs <json> <md>` on each. It saves the review as `r<N>/<delegate>.md` and prints the resolved model (e.g. `claude-opus-5-5`, for the score table), the `sessionId`, the changed files and the score:

- **Exit 2, empty result:** the delegate ran out of steps or drifted into plan mode. Re-run that delegate in a fresh session (no `--session-id`) with the same brief, which is self-contained.
- **Exit 3, changed files:** revert them and report it to the user.
- Compare `git status --short --ignored` with the state before the round: Junie's own writes (e.g. `.junie/`) land in ignored paths that plain `git status` hides. Remove them.

Later rounds pass a delegate's `sessionId` as `--session-id=<id>`, so it remembers what it raised. A resumed session that comes back empty once goes fresh for the rest of the run.

## 4. Report the round

Keep the axes apart, as `code-review` does: per axis, summarise the findings both delegates raise, the ones only one raises, where they disagree, and the recommended next steps. Give each delegate's score per axis. Each full pass by both delegates is one **round**.

Hand the **report page** to a subagent after every round, so the next round doesn't wait on it: `report/build.mjs` builds it from the run folder and `report.json` (fields in [`report/README.md`](report/README.md)), and the subagent publishes `site/` as a private artifact, patching in the round's new files. For a design review, the page shows each screen next to the same screen from the round before. Give the user the link once, after the first round.

## 5. Iterate

Apply the recommendations you agree with, one commit per round, and name the ones you reject, with the reason. Rejected ones join the template's **kept on purpose** list. Write the round's `changes.md`, then convene a new round (step 3 with each `--session-id`), until both delegates are satisfied, or every delegate meets the target.

Hold the scope to the spec. A recommendation that adds behaviour the spec didn't ask for becomes a follow-up for the user, not a change on this branch. When a round raises only findings you've already rejected, stop and put the disagreement to the user.

A subagent stopped by a usage limit keeps its work: once the limit resets, send it a message to continue rather than starting a new one.

## 6. Record

If the work ends in a pull request, put the results in its description, just before the closing attribution line if there is one. Edit the description; the council's results don't go in a comment.

```markdown
## Council review

Rounds: 2

| Delegate        | Axis      | Round 1 | Round 2 |
| --------------- | --------- | ------- | ------- |
| claude-opus-5-5 | Standards | 7/10    | 9/10    |
| claude-opus-5-5 | Spec      | 8/10    | 10/10   |
| gpt-6.1-sol     | Standards | 6/10    | 9/10    |
| gpt-6.1-sol     | Spec      | 8/10    | 9/10    |
```

A design review has one row per delegate, on the Design axis. A delegate that gives no score gets `no score`, with a line under the table saying why. Below the table, list the rejected recommendations with their reasons, and the minor findings left as follow-ups. Without a PR, the same results go in the final reply only.

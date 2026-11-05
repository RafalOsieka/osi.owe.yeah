---
name: council
description: "Put the current work before a council of two delegates (Opus and GPT Sol, run through Junie) and iterate in rounds until both are satisfied. Use when the user says 'council'."
metadata:
  credits:
    skill: council
    author: Theo Browne
    organisation: T3
    url: "https://github.com/t3dotgg/tstack/blob/main/skills/council/SKILL.md"
---

A **council** is two **delegates** working the same request independently: `opus` and `gpt-sol`, each at high effort, both run through the Junie CLI. If the user names other members, use those. Every member the user expects must actually sit: if one can't run, report it to the user rather than seating a substitute.

The usual request is a code review. For anything else (feedback on a plan, an idea, a design), run the same steps with the request and its context pointers as the brief, and no scores.

## 1. Settle the work

Before the audit, address outstanding PR comments, fix known issues, and run the relevant checks. The council reviews the work as it stands, so known fixes go in first. If the user is discarding the implementation to explore new ideas, skip fixes to code that's being replaced.

## 2. Write the brief

For a code review, run steps 1–3 of the `code-review` skill: pin the fixed point, find the spec, gather the standards sources and the smell baseline. Then write one **brief** file to a fresh temp directory outside the repo (`mktemp -d`). It carries:

- the diff command and commit list;
- the spec, as a path or pasted in;
- the standards source files, plus the smell baseline pasted in full;
- both sub-agent briefs from `code-review` step 4, **Standards** and **Spec**, each asking for a score out of 10 for that axis;
- a read-only rule: the delegate reads files and runs read-only commands, and leaves the working tree exactly as it found it;
- the reply shape: a `## Standards` section and a `## Spec` section, each ending in `Score: N/10`.

The brief is done when a delegate with no other context could run the whole review from it.

## 3. Convene

Start both delegates in parallel, in the background, piping the brief in as the task:

```bash
cat "$DIR/brief.md" | env -u PSModulePath cmd //c "junie --skip-update-check --model=opus --effort=high --output-format=json --json-output-file=$DIR/opus-round-1.json"
```

Do the same with `--model=gpt-sol`. Two Junie quirks shape that command:

- The `junie` launcher spawns Windows PowerShell 5, which fails (`Could not create a private restart directory`) under PowerShell 7's `PSModulePath`. Unsetting it lets PowerShell 5 rebuild its own.
- Junie needs stdin to be a pipe; with no pipe it fails with `Incorrect function` (`Niepoprawna funkcja`). Piping the brief also keeps it off the command line.

A round takes minutes. Wait for both runs to finish, then check each JSON result:

- `changes` is `[]` and `git status` matches what it was before the round. Junie always keeps its terminal tools, so read-only holds only by instruction, and this is the check. If a delegate changed anything, revert it and report it.
- `llmUsage` holds the requested model (Junie's own helper models sit beside it). Record its resolved name, e.g. `claude-opus-5-5`; that name goes in the score table.
- Keep the `sessionId`. Later rounds pass it as `--session-id=<id>`, so each delegate remembers what it raised.

## 4. Report the round

Keep the two axes apart, as `code-review` does: under `## Standards` and `## Spec`, summarise the findings both delegates raise, the ones only one raises, where they disagree, and the recommended next steps. Give each delegate's score per axis. Each full pass by both delegates is one **round**.

## 5. Iterate

Apply the recommendations you agree with and name the ones you reject, with the reason. Then convene a new round (step 3 with each `--session-id`, briefed on what changed), until both delegates are satisfied.

Hold the scope to the spec. A recommendation that adds behaviour the spec didn't ask for becomes a follow-up for the user, not a change on this branch. When a round raises only findings you've already rejected, stop and put the disagreement to the user.

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

A delegate that gives no score gets `no score`. Without a PR, the same results go in the final reply only.

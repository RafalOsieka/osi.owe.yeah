# The report page

`node report/build.mjs <runDir>` turns the run folder into `<runDir>/site/`: one page with the score table, every round's reviews side by side, and for a design review each round's screenshots next to the round before (or the round alone). A screenshot opens a full-screen viewer with that screen from both rounds side by side, scrolling together, with screen, round-pair, theme and zoom controls (←/→, +/−/0, ctrl+wheel). Publish `site/` as a private artifact (`index.html` plus `shots/`), patching in each round's new files.

## `<runDir>/report.json`

```json
{
  "title": "Owe Yeah UI polish: council reports",
  "lede": "Two delegates judge the same screenshots each round, at 390 px, light and dark.",
  "target": 9,
  "pr": "https://github.com/owner/repo/pull/1",
  "delegates": [
    { "key": "opus", "name": "Opus", "model": "claude-opus-5-5" },
    { "key": "sol", "name": "GPT Sol", "model": "gpt-6.1-sol" }
  ],
  "themes": ["light", "dark"],
  "screens": [["01-home", "Home, first visit"]],
  "rounds": [
    {
      "n": 0,
      "title": "Baseline",
      "commit": "abc1234",
      "changes": ["What went into this round, one line each."],
      "scores": { "opus": 6, "sol": "none" },
      "notes": { "sol": "Why a score is missing, or anything a reader should know." }
    }
  ]
}
```

- `scores`: a number, `null` while the delegate is reviewing, or `"none"` when it finished without a score.
- `key` names the review file: `<runDir>/r<n>/<key>.md`, as `scripts/result.mjs` saves it.
- `screens` and `themes` are for design reviews; a screenshot is `<runDir>/r<n>/shots/<theme>-<screen>.png`. A code review leaves `screens` out and the page shows reviews only.
- `target` defaults to 9; `themes` to `["light", "dark"]`.

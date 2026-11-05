// Builds the council's report page: every round's scores, both reviews side by side and, for
// a design review, the screenshots judged, each next to the same screen from the round
// before. Usage: node build.mjs <runDir>   (writes <runDir>/site/, ready to publish)
//
// <runDir>/report.json (see report/README.md for its fields) lists the delegates, screens
// and rounds; each round's reviews are <runDir>/r<n>/<delegate key>.md (as result.mjs saves
// them) and its screenshots <runDir>/r<n>/shots/<theme>-<screen>.png.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [runDir] = process.argv.slice(2);
if (!runDir) throw new Error('Usage: node build.mjs <runDir>');
const data = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
const target = data.target ?? 9;
const themes = data.themes ?? ['light', 'dark'];
const screens = data.screens ?? [];
const site = join(runDir, 'site');
rmSync(site, { recursive: true, force: true });
mkdirSync(join(site, 'shots'), { recursive: true });

const esc = (s) =>
  String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const inline = (s) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

// A small Markdown subset: headings, nested bullet and numbered lists, paragraphs. The score
// sits in the card header, so "Score: N/10" lines and trailing bold scores are dropped.
function markdown(text) {
  const out = [];
  const stack = [];
  const close = (depth) => {
    while (stack.length > depth) out.push(`</li></${stack.pop()}>`);
  };
  let para = [];
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const body = text.replace(/\r/g, '').replace(/\s*\*\*Score:[^*\n]*\*\*[ \t]*$/gm, '');
  for (const raw of body.split('\n')) {
    if (!raw.trim()) {
      flush();
      continue;
    }
    const item = raw.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    const heading = raw.match(/^#{2,4}\s+(.*)$/);
    if (heading) {
      flush();
      close(0);
      out.push(`<h4>${inline(heading[1])}</h4>`);
    } else if (item) {
      flush();
      const depth = Math.floor(item[1].length / 2) + 1;
      const tag = /\d/.test(item[2]) ? 'ol' : 'ul';
      if (stack.length < depth) {
        while (stack.length < depth) {
          out.push(`<${tag}><li>`);
          stack.push(tag);
        }
      } else {
        close(depth);
        out.push('</li><li>');
      }
      out.push(inline(item[3]));
    } else if (/^Score:/.test(raw.trim())) {
      flush();
      close(0);
    } else if (stack.length) {
      out.push(' ' + inline(raw.trim()));
    } else {
      para.push(raw.trim());
    }
  }
  flush();
  close(0);
  return out.join('');
}

// A score as report.json has it: a number, null while the delegate is still reviewing, or
// "none" when it finished without one. Read once into what the page branches on.
function scoreOf(round, key) {
  const raw = round.scores?.[key] ?? null;
  if (raw === null) return { kind: 'pending' };
  if (raw === 'none') return { kind: 'none' };
  if (Number.isFinite(raw)) return { kind: 'scored', value: raw };
  throw new Error(`Round ${round.n}: ${key}'s score is ${JSON.stringify(raw)}`);
}
const settled = (round) => data.delegates.every(({ key }) => scoreOf(round, key).kind !== 'pending');
const passes = (score) => score.kind === 'scored' && score.value >= target;
const shown = (score) =>
  score.kind === 'scored' ? `${score.value}` : score.kind === 'none' ? 'no score' : '…';

const shotsDir = (round) => join(runDir, `r${round.n}`, 'shots');
const hasShots = (round) => existsSync(shotsDir(round));
const fileOf = (theme, screen) => (theme ? `${theme}-${screen}.png` : `${screen}.png`);
const shotPath = (round, theme, screen) => `shots/r${round.n}/${fileOf(theme, screen)}`;
const shotExists = (round, theme, screen) =>
  existsSync(join(shotsDir(round), fileOf(theme, screen)));

const scoreTable = `
<table class="scores">
  <thead><tr><th scope="col">Delegate</th>${data.rounds
    .map(
      (r) =>
        `<th scope="col"><a href="#round-${r.n}"><span class="long">Round ${r.n}</span><span class="short" aria-hidden="true">R${r.n}</span></a></th>`,
    )
    .join('')}</tr></thead>
  <tbody>${data.delegates
    .map(
      ({ key, name, model }) =>
        `<tr><th scope="row">${esc(name)}<span class="model">${esc(model)}</span></th>${data.rounds
          .map((r) => {
            const score = scoreOf(r, key);
            return `<td class="${passes(score) ? 'pass' : ''}"><span class="num${score.kind === 'none' ? ' none' : ''}">${shown(score)}</span>${
              score.kind === 'scored'
                ? `<span class="bar"><span style="width:${score.value * 10}%"></span></span>`
                : ''
            }</td>`;
          })
          .join('')}</tr>`,
    )
    .join('')}</tbody>
</table>`;

const themeSwitch = () =>
  themes.length < 2
    ? ''
    : `<div class="theme-switch" role="group" aria-label="Screenshot theme">${themes
        .map(
          (theme, i) =>
            `<button type="button" aria-pressed="${i === 0}" data-theme-pick="${theme}">${esc(theme)}</button>`,
        )
        .join('')}</div>`;

// A thumbnail that opens the viewer on `screen` in `theme`, comparing round `open` with the round
// before it. `open` is the section's round, so a round-2 shot in round 3's pairs opens 2 | 3.
const shotButton = (round, theme, screen, label, open = round) => `
  <button type="button" class="shot" data-screen="${esc(screen)}" data-theme="${esc(theme)}" data-round="${open.n}" aria-label="Compare ${esc(label)}, ${esc(theme)}, round ${open.n} with the round before">
    <img src="${shotPath(round, theme, screen)}" alt="${esc(label)}, ${esc(theme)}, round ${round.n}" loading="lazy" decoding="async">
  </button>`;

/** The round's screenshots as a strip. */
function strip(round) {
  return themes
    .map(
      (theme, i) => `
    <div class="strip" data-theme-strip="${theme}"${i > 0 ? ' hidden' : ''}>${screens
      .filter(([screen]) => shotExists(round, theme, screen))
      .map(
        ([screen, label]) =>
          `<figure>${shotButton(round, theme, screen, label)}<figcaption>${esc(label)}</figcaption></figure>`,
      )
      .join('')}</div>`,
    )
    .join('');
}

/** Each of the round's screens next to the same screen in `before`. */
function comparison(round, before) {
  return themes
    .map(
      (theme, i) => `
    <div class="pairs" data-theme-strip="${theme}"${i > 0 ? ' hidden' : ''}>${screens
      .filter(([screen]) => shotExists(round, theme, screen))
      .map(
        ([screen, label]) => `
      <figure class="pair">
        <figcaption>${esc(label)}</figcaption>
        <div class="pair-shots">
          <div>${
            shotExists(before, theme, screen)
              ? shotButton(before, theme, screen, label, round)
              : '<p class="new">New this round</p>'
          }<span class="tag">Round ${before.n}</span></div>
          <div>${shotButton(round, theme, screen, label)}<span class="tag now">Round ${round.n}</span></div>
        </div>
      </figure>`,
      )
      .join('')}</div>`,
    )
    .join('');
}

const rounds = data.rounds
  .map((round, index) => {
    if (hasShots(round)) {
      cpSync(shotsDir(round), join(site, 'shots', `r${round.n}`), { recursive: true });
    }
    const before = data.rounds.slice(0, index).reverse().find(hasShots);
    const reviews = data.delegates
      .map(({ key, name, model }) => {
        const score = scoreOf(round, key);
        const path = join(runDir, `r${round.n}`, `${key}.md`);
        const body = existsSync(path)
          ? markdown(readFileSync(path, 'utf8'))
          : `<p class="muted">${score.kind === 'none' ? 'No final answer.' : 'Still reviewing.'}</p>`;
        const note = round.notes?.[key];
        return `
        <article class="review">
          <header>
            <h3>${esc(name)} <span class="model">${esc(model)}</span></h3>
            <span class="score ${passes(score) ? 'pass' : ''}">${shown(score)}${score.kind === 'scored' ? '<small>/10</small>' : ''}</span>
          </header>
          ${note ? `<p class="note">${esc(note)}</p>` : ''}
          <div class="prose">${body}</div>
        </article>`;
      })
      .join('');
    const pictures = !hasShots(round)
      ? ''
      : before
        ? `<h3 class="label">The screenshots judged, next to round ${before.n}</h3>${themeSwitch()}
           <div class="view-switch" role="group" aria-label="Screenshot view">
             <button type="button" aria-pressed="true" data-view-pick="pairs">Side by side</button>
             <button type="button" aria-pressed="false" data-view-pick="strip">This round only</button>
           </div>
           <div data-view="pairs">${comparison(round, before)}</div>
           <div data-view="strip" hidden>${strip(round)}</div>`
        : `<h3 class="label">The screenshots judged</h3>${themeSwitch()}${strip(round)}`;
    return `
    <section class="round" id="round-${round.n}" aria-labelledby="round-${round.n}-title">
      <h2 id="round-${round.n}-title">Round ${round.n}${round.title ? `: ${esc(round.title)}` : ''}</h2>
      ${round.commit ? `<p class="muted">Commits: <code>${esc(round.commit)}</code></p>` : ''}
      ${round.changes?.length ? `<h3 class="label">Going into this round</h3><ul class="changes">${round.changes.map((c) => `<li>${inline(c)}</li>`).join('')}</ul>` : ''}
      ${pictures}
      <h3 class="label">Reviews</h3>
      <div class="reviews">${reviews}</div>
    </section>`;
  })
  .join('');

// What the viewer needs: each round with shots, the round it is compared with, and its shots
// by theme and screen. Embedded as JSON; `<` is escaped so no label can close the script.
const viewerData = {
  screens,
  themes,
  rounds: data.rounds.filter(hasShots).map((round, i, withShots) => ({
    n: round.n,
    before: i > 0 ? withShots[i - 1].n : null,
    shots: Object.fromEntries(
      themes.map((theme) => [
        theme,
        Object.fromEntries(
          screens
            .filter(([screen]) => shotExists(round, theme, screen))
            .map(([screen]) => [screen, shotPath(round, theme, screen)]),
        ),
      ]),
    ),
  })),
};
const viewerJson = JSON.stringify(viewerData).replaceAll('<', '\\u003c');

const scored = (round) =>
  data.delegates.map(({ key, name }) => `${name} ${shown(scoreOf(round, key))}`).join(', ');
const goal = data.rounds.find((r) => data.delegates.every(({ key }) => passes(scoreOf(r, key))));
const latest = [...data.rounds].reverse().find(settled);
const pending = data.rounds.find((r) => !settled(r));
const status = goal
  ? `Goal reached in round ${goal.n}: ${scored(goal)}.`
  : pending
    ? `Round ${pending.n} is with the council now.${latest ? ` Latest complete round: ${latest.n}, scored ${scored(latest)}.` : ''}`
    : latest
      ? `Latest round: ${latest.n}, scored ${scored(latest)}.`
      : '';

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(data.title)}</title>
<style>
/* Dark only: the page frames screenshots of both themes, and a dark frame is easier on the eyes. */
:root {
  color-scheme: dark;
  --bg: #0c0a09; --surface: #1c1917; --ink: #f5f5f4; --soft: #a8a29e; --rule: #292524;
  --accent: #10b981; --accent-soft: #064e3b; --bar: #57534e;
  --sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html { background: var(--bg); color: var(--ink); }
body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--ink); font: 16px/1.55 var(--sans); }
main { max-width: 72rem; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
a { color: var(--accent); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
h1 { font-size: 2rem; line-height: 1.15; letter-spacing: -.02em; margin: 0 0 .5rem; }
.lede { color: var(--soft); max-width: 65ch; margin: 0 0 1.5rem; }
.pr { margin: -1rem 0 1.25rem; }
.muted { color: var(--soft); font-size: .9rem; }
code { font-family: var(--mono); font-size: .88em; overflow-wrap: anywhere; }
.panel { background: var(--surface); border: 1px solid var(--rule); border-radius: 14px; padding: 1rem 1.25rem; }
.scores { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
.scores th, .scores td { padding: .6rem .75rem; border-bottom: 1px solid var(--rule); text-align: left; }
.scores tbody tr:last-child > * { border-bottom: 0; }
.scores thead th { font-size: .8rem; color: var(--soft); font-weight: 600; }
.scores .model { display: block; font-size: .75rem; color: var(--soft); font-weight: 400; font-family: var(--mono); }
.scores .num { font-weight: 600; display: inline-block; min-width: 2.2em; }
.scores .bar { display: inline-block; width: 4rem; height: 6px; border-radius: 3px; background: var(--rule); vertical-align: middle; }
.scores .bar span { display: block; height: 100%; border-radius: 3px; background: var(--bar); }
.scores .pass .bar span { background: var(--accent); }
.scores .pass .num { color: var(--accent); }
.scores .num.none { font-size: .75rem; font-weight: 500; color: var(--soft); }
.scores .short { display: none; }
.table-wrap { overflow-x: auto; }
@media (max-width: 480px) {
  .table-wrap { padding: .75rem .5rem; }
  .scores th, .scores td { padding: .5rem .3rem; }
  .scores .num { min-width: 0; }
  .scores .bar { display: block; width: 1.75rem; margin-top: .3rem; }
  .scores .long, .scores .model { display: none; }
  .scores .short { display: inline; }
}
nav.jump { display: flex; gap: .5rem; flex-wrap: wrap; margin: 1.5rem 0 0; }
nav.jump a { text-decoration: none; padding: .35rem .8rem; border-radius: 999px; border: 1px solid var(--rule); color: var(--ink); background: var(--surface); font-size: .9rem; }
.round { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--rule); }
.round h2 { font-size: 1.5rem; letter-spacing: -.01em; margin: 0 0 .25rem; }
h3.label { font-size: .85rem; color: var(--soft); font-weight: 600; margin: 1.75rem 0 .6rem; }
.changes { margin: 0; padding-left: 1.2rem; max-width: 75ch; }
.theme-switch, .view-switch { display: inline-flex; border: 1px solid var(--rule); border-radius: 999px; overflow: hidden; margin: 0 .5rem .75rem 0; }
.theme-switch button, .view-switch button { font: inherit; font-size: .85rem; border: 0; background: var(--surface); color: var(--ink); padding: .3rem .9rem; cursor: pointer; text-transform: capitalize; }
.theme-switch button[aria-pressed="true"], .view-switch button[aria-pressed="true"] { background: var(--accent); color: #0c0a09; }
.strip { display: grid; grid-auto-flow: column; grid-auto-columns: 9.5rem; gap: .75rem; overflow-x: auto; padding-bottom: .5rem; }
.strip figure { margin: 0; }
.shot { padding: 0; border: 1px solid var(--rule); border-radius: 12px; overflow: hidden; background: var(--surface); cursor: zoom-in; display: block; width: 100%; aspect-ratio: 390 / 600; }
.shot img { width: 100%; display: block; }
figcaption { font-size: .78rem; color: var(--soft); margin-top: .35rem; }
.pairs { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 19rem), 1fr)); gap: 1.25rem 1rem; }
.pair { margin: 0; }
.pair figcaption { margin: 0 0 .4rem; font-weight: 600; color: var(--ink); font-size: .85rem; }
.pair-shots { display: grid; grid-template-columns: 1fr 1fr; gap: .5rem; }
.pair-shots > div { display: flex; flex-direction: column; gap: .3rem; }
.tag { font-size: .72rem; color: var(--soft); text-align: center; }
.tag.now { color: var(--accent); font-weight: 600; }
.new { margin: 0; aspect-ratio: 390 / 600; display: grid; place-items: center; border: 1px dashed var(--rule); border-radius: 12px; color: var(--soft); font-size: .8rem; }
.reviews { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 26rem), 1fr)); gap: 1rem; align-items: start; }
.review { background: var(--surface); border: 1px solid var(--rule); border-radius: 14px; padding: 1.1rem 1.25rem; }
.review header { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; border-bottom: 1px solid var(--rule); padding-bottom: .6rem; margin-bottom: .6rem; }
.review h3 { margin: 0; font-size: 1.1rem; }
.review .model { font: 400 .75rem var(--mono); color: var(--soft); margin-left: .35rem; }
.score { font-size: 1.6rem; font-weight: 700; font-variant-numeric: tabular-nums; }
.score small { font-size: .8rem; color: var(--soft); font-weight: 500; }
.score.pass { color: var(--accent); }
.note { background: var(--accent-soft); border-radius: 8px; padding: .5rem .75rem; font-size: .88rem; }
.prose { font-size: .93rem; }
.prose h4 { font-size: .95rem; margin: 1.1rem 0 .3rem; }
.prose ul, .prose ol { padding-left: 1.2rem; margin: .3rem 0; }
.prose li { margin: .25rem 0; }
.prose p { margin: .5rem 0; }
/* The viewer: the whole viewport, a toolbar on top and one scroll box below holding both rounds
   in a row, so they scroll together. Columns fit the width (capped at the shots' own
   780 px, a 390 px screen at 2x) and --z scales them; never clamp the height, which is what made a tall
   capture a sliver before. Colours are explicit: the host may restyle body. */
body:has(#viewer[open]) { overflow: hidden; }
#viewer { position: fixed; inset: 0; width: 100%; height: 100%; height: 100dvh; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; background: var(--bg); color: var(--ink); font: 15px/1.4 var(--sans); }
#viewer[open] { display: flex; flex-direction: column; }
#viewer::backdrop { background: var(--bg); }
.v-bar { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem .75rem; padding: .6rem 1rem; background: var(--surface); border-bottom: 1px solid var(--rule); }
.v-title { flex: 1 1 14rem; min-width: 0; margin: 0; font-size: 1rem; font-weight: 600; }
.v-title small { display: block; color: var(--soft); font-weight: 400; font-size: .8rem; }
.v-group { display: inline-flex; align-items: center; border: 1px solid var(--rule); border-radius: 999px; overflow: hidden; }
.v-group > * + * { border-left: 1px solid var(--rule); }
.v-bar button { font: inherit; font-size: .85rem; border: 0; background: var(--bg); color: var(--ink); padding: .35rem .75rem; cursor: pointer; min-height: 2rem; }
.v-bar button[aria-pressed="true"] { background: var(--accent); color: #0c0a09; }
.v-bar button:disabled { color: var(--bar); cursor: default; }
.v-bar .v-zoom-level { min-width: 4.2em; font-variant-numeric: tabular-nums; }
.v-bar .v-close { border: 1px solid var(--rule); border-radius: 999px; }
.v-stage { flex: 1; overflow: auto; overscroll-behavior: contain; padding: 0 1rem 2rem; background: var(--bg); color: var(--ink); }
.v-cols { --z: 1; --n: 2; display: flex; gap: 1rem; margin: 0 auto; width: calc(min(100%, var(--n) * 780px + (var(--n) - 1) * 1rem) * var(--z)); }
.v-col { flex: 1 1 0; min-width: 0; }
.v-col h3 { position: sticky; top: 0; z-index: 1; margin: 0; padding: .5rem 0; background: var(--bg); color: var(--soft); font-size: .85rem; font-weight: 600; text-align: center; }
.v-col.now h3 { color: var(--accent); }
.v-col img { display: block; width: 100%; height: auto; border-radius: 12px; border: 1px solid var(--rule); background: var(--surface); }
.v-col .new { aspect-ratio: 390 / 844; }
@media (max-width: 480px) {
  .v-bar { padding: .5rem .75rem; }
  .v-stage { padding: 0 .5rem 2rem; }
  .v-cols { gap: .5rem; }
}
</style>
</head>
<body>
<main>
  <h1>${esc(data.title)}</h1>
  <p class="lede">${data.lede ? `${esc(data.lede)} ` : ''}Goal: every delegate scores ${target}/10 or more. ${esc(status)}</p>
  ${data.pr ? `<p class="muted pr">Pull request: <a href="${esc(data.pr)}">${esc(data.pr.replace('https://github.com/', ''))}</a></p>` : ''}
  <div class="panel table-wrap">${scoreTable}</div>
  <nav class="jump" aria-label="Rounds">${data.rounds.map((r) => `<a href="#round-${r.n}">Round ${r.n}${r.title ? `: ${esc(r.title)}` : ''}</a>`).join('')}</nav>
  ${rounds}
</main>
<dialog id="viewer" aria-labelledby="v-title">
  <div class="v-bar">
    <h2 class="v-title" id="v-title"><span class="v-screen"></span><small class="v-where"></small></h2>
    <div class="v-group" role="group" aria-label="Screen">
      <button type="button" class="v-prev" aria-label="Previous screen" title="Previous screen (←)">‹ Prev</button>
      <button type="button" class="v-next" aria-label="Next screen" title="Next screen (→)">Next ›</button>
    </div>
    <div class="v-group v-rounds" role="group" aria-label="Rounds compared"></div>
    <div class="v-group v-themes" role="group" aria-label="Theme"></div>
    <div class="v-group" role="group" aria-label="Zoom">
      <button type="button" class="v-out" aria-label="Zoom out" title="Zoom out (−)">−</button>
      <button type="button" class="v-zoom-level" aria-label="Reset zoom to fit the width" title="Fit width (0)">100%</button>
      <button type="button" class="v-in" aria-label="Zoom in" title="Zoom in (+)">+</button>
    </div>
    <button type="button" class="v-close" title="Close (Esc)">Close</button>
  </div>
  <div class="v-stage" tabindex="0" aria-label="Screenshots, scrollable">
    <div class="v-cols"></div>
  </div>
</dialog>
<script type="application/json" id="viewer-data">${viewerJson}</script>
<script>
// The viewer. A thumbnail opens it on its screen, theme and round; it shows that round next to
// the round before (round 1 alone) and keeps the screen, rounds, theme and zoom as state.
const viewer = document.getElementById('viewer');
const DATA = JSON.parse(document.getElementById('viewer-data').textContent);
const stage = viewer.querySelector('.v-stage');
const cols = viewer.querySelector('.v-cols');
const roundOf = (n) => DATA.rounds.find((r) => r.n === n);
const labelOf = (screen) => DATA.screens.find(([id]) => id === screen)?.[1] ?? screen;
const state = { screen: '', theme: DATA.themes[0], round: 0, zoom: 1 };
let opener = null;

// The theme shown: the one asked for when either round has it, else the first that exists.
const themeShown = () => {
  const round = roundOf(state.round);
  const before = round.before === null ? null : roundOf(round.before);
  const has = (theme) => round.shots[theme]?.[state.screen] || before?.shots[theme]?.[state.screen];
  return has(state.theme) ? state.theme : DATA.themes.find(has) ?? state.theme;
};
// Screens either compared round captured, in the order the report lists them.
const screensHere = () => {
  const round = roundOf(state.round);
  const before = round.before === null ? null : roundOf(round.before);
  return DATA.screens
    .map(([id]) => id)
    .filter((id) => DATA.themes.some((t) => round.shots[t]?.[id] || before?.shots[t]?.[id]));
};

function column(n, theme, now) {
  const path = roundOf(n).shots[theme]?.[state.screen];
  const col = document.createElement('div');
  col.className = 'v-col' + (now ? ' now' : '');
  const title = document.createElement('h3');
  title.textContent = 'Round ' + n;
  col.append(title);
  if (path) {
    const img = document.createElement('img');
    img.src = path;
    img.alt = labelOf(state.screen) + ', ' + theme + ', round ' + n;
    col.append(img);
  } else {
    const missing = document.createElement('p');
    missing.className = 'new';
    missing.textContent = now ? 'Not captured this round' : 'New in round ' + state.round;
    col.append(missing);
  }
  return col;
}

function render() {
  const round = roundOf(state.round);
  const theme = themeShown();
  const list = screensHere();
  const index = list.indexOf(state.screen);
  viewer.querySelector('.v-screen').textContent = labelOf(state.screen);
  viewer.querySelector('.v-where').textContent =
    (round.before === null ? 'Round ' + round.n : 'Round ' + round.before + ' | Round ' + round.n) +
    ' · ' + theme + ' · screen ' + (index + 1) + ' of ' + list.length;
  viewer.querySelector('.v-prev').disabled = index <= 0;
  viewer.querySelector('.v-next').disabled = index === -1 || index >= list.length - 1;
  const parts = round.before === null ? [column(round.n, theme, true)] : [column(round.before, theme, false), column(round.n, theme, true)];
  cols.style.setProperty('--n', String(parts.length));
  cols.replaceChildren(...parts);
  viewer.querySelector('.v-rounds').replaceChildren(
    ...DATA.rounds.map((r) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.round = String(r.n);
      button.textContent = r.before === null ? 'R' + r.n : 'R' + r.before + ' | R' + r.n;
      button.setAttribute('aria-label', r.before === null ? 'Round ' + r.n + ' alone' : 'Round ' + r.before + ' next to round ' + r.n);
      button.setAttribute('aria-pressed', String(r.n === state.round));
      return button;
    }),
  );
  viewer.querySelector('.v-themes').replaceChildren(
    ...(DATA.themes.length < 2 ? [] : DATA.themes.map((t) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.theme = t;
      button.textContent = t;
      button.setAttribute('aria-pressed', String(t === theme));
      button.disabled = !(round.shots[t]?.[state.screen] || (round.before !== null && roundOf(round.before).shots[t]?.[state.screen]));
      return button;
    })),
  );
  viewer.querySelector('.v-zoom-level').textContent = Math.round(state.zoom * 100) + '%';
}

// Zoom by factor, keeping the point under (x, y) in the stage (its centre by default) in place.
function zoomBy(factor, x = stage.clientWidth / 2, y = stage.clientHeight / 2) {
  const next = Math.min(8, Math.max(0.25, factor === 0 ? 1 : state.zoom * factor));
  const oldWidth = cols.offsetWidth;
  const left = stage.scrollLeft + x;
  const top = stage.scrollTop + y;
  state.zoom = next;
  cols.style.setProperty('--z', String(next));
  const ratio = cols.offsetWidth / oldWidth;
  stage.scrollLeft = left * ratio - x;
  stage.scrollTop = top * ratio - y;
  viewer.querySelector('.v-zoom-level').textContent = Math.round(next * 100) + '%';
}

function step(delta) {
  const list = screensHere();
  const target = list[list.indexOf(state.screen) + delta];
  if (!target) return;
  state.screen = target;
  render();
  stage.scrollTop = 0;
  stage.scrollLeft = 0;
}

viewer.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  if (button.matches('.v-close')) viewer.close();
  else if (button.matches('.v-prev')) step(-1);
  else if (button.matches('.v-next')) step(1);
  else if (button.matches('.v-in')) zoomBy(1.25);
  else if (button.matches('.v-out')) zoomBy(0.8);
  else if (button.matches('.v-zoom-level')) zoomBy(0);
  else if (button.dataset.round) {
    state.round = Number(button.dataset.round);
    render();
  } else if (button.dataset.theme) {
    state.theme = button.dataset.theme;
    render();
  }
});
viewer.addEventListener('keydown', (event) => {
  if (event.altKey || event.metaKey) return;
  const key = event.key;
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    if (event.ctrlKey) return;
    event.preventDefault();
    step(key === 'ArrowLeft' ? -1 : 1);
  } else if (key === '+' || key === '=' || key === '-' || key === '_' || key === '0') {
    // Ctrl/Cmd + and − too: browser zoom cannot grow a fit-to-width shot, the viewer's zoom can.
    event.preventDefault();
    zoomBy(key === '0' ? 0 : key === '-' || key === '_' ? 0.8 : 1.25);
  }
});
// Ctrl + wheel, which is also how a trackpad pinch arrives, zooms around the pointer.
stage.addEventListener('wheel', (event) => {
  if (!event.ctrlKey) return;
  event.preventDefault();
  const box = stage.getBoundingClientRect();
  zoomBy(Math.exp(-event.deltaY / 300), event.clientX - box.left, event.clientY - box.top);
}, { passive: false });
viewer.addEventListener('close', () => opener?.focus());

const pick = (round, attribute, value) => {
  for (const button of round.querySelectorAll('[data-' + attribute + '-pick]')) {
    button.setAttribute('aria-pressed', String(button.dataset[attribute + 'Pick'] === value));
  }
};
document.addEventListener('click', (event) => {
  const shot = event.target.closest('.shot');
  if (shot) {
    opener = shot;
    Object.assign(state, { screen: shot.dataset.screen, theme: shot.dataset.theme, round: Number(shot.dataset.round), zoom: 1 });
    cols.style.setProperty('--z', '1');
    render();
    viewer.showModal();
    stage.scrollTop = 0;
    stage.scrollLeft = 0;
    stage.focus();
    return;
  }
  const round = event.target.closest('.round');
  const theme = event.target.closest('[data-theme-pick]');
  if (theme && round) {
    pick(round, 'theme', theme.dataset.themePick);
    for (const part of round.querySelectorAll('[data-theme-strip]')) {
      part.hidden = part.dataset.themeStrip !== theme.dataset.themePick;
    }
  }
  const view = event.target.closest('[data-view-pick]');
  if (view && round) {
    pick(round, 'view', view.dataset.viewPick);
    for (const part of round.querySelectorAll('[data-view]')) {
      part.hidden = part.dataset.view !== view.dataset.viewPick;
    }
  }
});
</script>
</body>
</html>`;

writeFileSync(join(site, 'index.html'), html);
console.log(join(site, 'index.html'));

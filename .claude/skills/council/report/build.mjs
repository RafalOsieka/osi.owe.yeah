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

const shotButton = (round, theme, screen, label) => `
  <button type="button" class="shot" data-full="${shotPath(round, theme, screen)}" data-label="${esc(label)} · ${esc(theme)} · round ${round.n}">
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
              ? shotButton(before, theme, screen, label)
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
:root {
  --bg: #f5f5f4; --surface: #fff; --ink: #1c1917; --soft: #57534e; --rule: #e7e5e4;
  --accent: #059669; --accent-soft: #d1fae5; --bar: #a8a29e;
  --sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #0c0a09; --surface: #1c1917; --ink: #f5f5f4; --soft: #a8a29e; --rule: #292524;
          --accent: #10b981; --accent-soft: #064e3b; --bar: #57534e; }
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html { background: var(--bg); color: var(--ink); }
body { margin: 0; font: 16px/1.55 var(--sans); }
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
.theme-switch button[aria-pressed="true"], .view-switch button[aria-pressed="true"] { background: var(--accent); color: #fff; }
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
dialog { border: 0; padding: 0; background: transparent; max-width: 95vw; max-height: 95vh; }
dialog::backdrop { background: rgb(0 0 0 / .7); }
dialog img { max-height: 88vh; max-width: 95vw; display: block; border-radius: 12px; }
dialog p { color: #fff; text-align: center; margin: .5rem 0 0; font-size: .9rem; }
dialog .close { position: fixed; top: 1rem; right: 1rem; font: inherit; border: 0; border-radius: 999px; padding: .4rem .9rem; cursor: pointer; }
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
<dialog id="zoom" aria-label="Screenshot">
  <button type="button" class="close">Close</button>
  <img alt="">
  <p></p>
</dialog>
<script>
const zoom = document.getElementById('zoom');
const pick = (round, attribute, value) => {
  for (const button of round.querySelectorAll('[data-' + attribute + '-pick]')) {
    button.setAttribute('aria-pressed', String(button.dataset[attribute + 'Pick'] === value));
  }
};
document.addEventListener('click', (event) => {
  const shot = event.target.closest('.shot');
  if (shot) {
    zoom.querySelector('img').src = shot.dataset.full;
    zoom.querySelector('img').alt = shot.dataset.label;
    zoom.querySelector('p').textContent = shot.dataset.label;
    zoom.showModal();
    return;
  }
  if (event.target.closest('.close') || event.target === zoom) zoom.close();
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

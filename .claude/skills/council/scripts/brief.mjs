// Writes one round's brief from the run's template, so no round ever reuses an earlier
// round's folder or numbers. Usage: node brief.mjs <runDir> <round>
//
// Reads <runDir>/template.md and, if present, <runDir>/r<round>/changes.md. Fills:
//   {{round}}    the round number
//   {{folder}}   the absolute path of <runDir>/r<round>/shots (design reviews)
//   {{changes}}  the contents of changes.md ("" when there is none)
// Writes <runDir>/r<round>/brief.md and prints its path. Fails when a placeholder is left,
// or when the template names {{folder}} and that folder holds no PNG.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [runDir, round] = process.argv.slice(2);
if (!runDir || !round) throw new Error('Usage: node brief.mjs <runDir> <round>');

const roundDir = resolve(runDir, `r${round}`);
const template = readFileSync(join(runDir, 'template.md'), 'utf8');
const changesPath = join(roundDir, 'changes.md');
const folder = join(roundDir, 'shots');

if (template.includes('{{folder}}')) {
  const shots = existsSync(folder) ? readdirSync(folder).filter((f) => f.endsWith('.png')) : [];
  if (shots.length === 0) throw new Error(`No screenshots in ${folder}`);
}

const brief = template
  .replaceAll('{{round}}', round)
  .replaceAll('{{folder}}', folder)
  .replaceAll('{{changes}}', existsSync(changesPath) ? readFileSync(changesPath, 'utf8').trim() : '');

const left = brief.match(/\{\{\w+\}\}/g);
if (left) throw new Error(`Unfilled placeholders: ${[...new Set(left)].join(', ')}`);

const out = join(roundDir, 'brief.md');
writeFileSync(out, brief);
console.log(out);

// Reads one delegate's Junie result for a round and saves its review as Markdown, keeping
// characters like €, ≈ and − intact. Usage: node result.mjs <result.json> <review.md>
//
// Prints the resolved model, the session id (for the next round's --session-id), the
// files it changed and its last "Score: N/10". Exits 2 when the result is empty (the
// delegate ran out of steps or drifted into plan mode: re-run it in a fresh session), and
// 3 when it changed files (revert them and report it).
import { readFileSync, writeFileSync } from 'node:fs';

const [resultPath, reviewPath] = process.argv.slice(2);
if (!resultPath || !reviewPath) throw new Error('Usage: node result.mjs <result.json> <review.md>');

const { result = '', sessionId, changes = [], llmUsage = [] } = JSON.parse(
  readFileSync(resultPath, 'utf8'),
);
// The requested model leads; Junie's helper models follow it.
const model = llmUsage[0]?.model ?? 'unknown';
const score = [...result.matchAll(/Score:\s*([\d.]+)\s*\/\s*10/g)].at(-1)?.[1] ?? 'none';

console.log(JSON.stringify({ model, sessionId, changes, score }));
if (!result.trim()) {
  console.error('Empty result: re-run this delegate in a fresh session.');
  process.exit(2);
}
writeFileSync(reviewPath, result);
if (changes.length > 0) {
  console.error('The delegate changed files: revert them and report it.');
  process.exit(3);
}

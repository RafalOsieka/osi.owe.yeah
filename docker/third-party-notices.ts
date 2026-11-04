// Writes an image's THIRD-PARTY-NOTICES.md: every npm package its JavaScript bundles or
// ships, each with the license and notice files it comes with, which minifying and Nitro's
// tracing leave behind. Run by the Dockerfile from the workspace root, after a build:
//
//   node docker/third-party-notices.ts <notices file> <build output dir>
//
// A package is in the image if a source map in the output names one of its files (it was
// bundled), or if the output holds its `package.json` under `node_modules` (Nitro traced it
// and copied the files it needs). Its files come from the package as installed in pnpm's
// virtual store, `node_modules/.pnpm`. As some ship none, or only a notice pointing at their
// license (`web-push`'s MPL-2.0), the full text of every license declared follows, from
// `licenses/`. A traced package the store lacks, a package without a license, or a license
// without a text fails the build, rather than leaving a notice out.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';

const [noticesFile, outputDir] = process.argv.slice(2);
if (!noticesFile || !outputDir) {
  throw new Error('Usage: node docker/third-party-notices.ts <notices file> <build output dir>');
}

const store = resolve('node_modules/.pnpm');
const noticeFile = /^(licen[cs]e|copying|notice)/i;

interface PackageJson {
  name: string;
  version: string;
  license?: string;
}

function readPackageJson(dir: string): PackageJson {
  // SAFETY: an installed package's manifest has a name and a version; `license` is optional.
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as PackageJson;
}

/** Every file under `dir`, recursively. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

/**
 * The directory of the package a file in `node_modules` belongs to: up to the one or two
 * segments (for a scope) after the last `node_modules`. Undefined for any other file, and for
 * tool caches such as `node_modules/.cache`.
 */
function packageDirOf(file: string): string | undefined {
  const parts = file.split(sep);
  const at = parts.lastIndexOf('node_modules');
  const name = parts[at + 1];
  if (at < 0 || !name || name.startsWith('.')) return undefined;
  return parts.slice(0, at + (name.startsWith('@') ? 3 : 2)).join(sep);
}

/** The directories of the packages the output's source maps name files of. */
function bundledPackages(files: string[]): string[] {
  return files
    .filter((file) => file.endsWith('.map'))
    .flatMap((map) => {
      // SAFETY: a source map lists the files it maps as `sources`.
      const { sources, sourceRoot = '' } = JSON.parse(readFileSync(map, 'utf8')) as {
        sources: string[];
        sourceRoot?: string;
      };
      return sources.map((source) => resolve(dirname(map), sourceRoot, source));
    })
    .flatMap((source) => packageDirOf(source) ?? []);
}

/** The directories in pnpm's store of the packages Nitro traced into the output. */
function tracedPackages(files: string[]): string[] {
  const storeEntries = readdirSync(store);
  return files
    .filter((file) => basename(file) === 'package.json')
    .flatMap((file) => {
      // Only a package's own manifest: Nitro also copies nested ones, such as `dist/package.json`.
      if (packageDirOf(file) !== dirname(file)) return [];
      const { name, version } = readPackageJson(dirname(file));
      // pnpm names a store entry `<name>@<version>`, `/` in a scope as `+`, and suffixes
      // `_<peers>` when peer dependencies tell copies apart, which hold the same files.
      const entry = `${name.replace('/', '+')}@${version}`;
      const match = storeEntries.find((e) => e === entry || e.startsWith(`${entry}_`));
      if (!match) throw new Error(`${name}@${version} is in ${outputDir} but not in ${store}`);
      return [join(store, match, 'node_modules', name)];
    });
}

/** A text as it is, fenced: license texts carry markdown headings of their own. */
const fenced = (text: string) => `~~~text\n${text.trim()}\n~~~\n`;

interface Notice {
  key: string;
  section: string;
  /** The SPDX ids in the package's `license`, such as `MIT` and `Apache-2.0` in `(MIT OR Apache-2.0)`. */
  licenses: string[];
}

/** A package's section: its name, version and license, then each license and notice file. */
function notice(dir: string): Notice {
  const { name, version, license } = readPackageJson(dir);
  if (!license) throw new Error(`${name}@${version} declares no license`);
  const texts = readdirSync(dir)
    .filter((file) => noticeFile.test(file))
    .sort()
    .map((file) => fenced(readFileSync(join(dir, file), 'utf8')));
  const body = texts.length ? texts.join('\n') : '_The package ships no license file._\n';
  return {
    key: `${name}@${version}`,
    section: `## ${name} - ${version} (${license})\n\n${body}`,
    licenses: (license.match(/[\w.+-]+/g) ?? []).filter(
      (id) => !['AND', 'OR', 'WITH'].includes(id),
    ),
  };
}

/** A license's standard text, under its SPDX id, from the SPDX license list in `licenses/`. */
function licenseText(id: string): string {
  const file = join(import.meta.dirname, 'licenses', `${id}.txt`);
  if (!existsSync(file)) {
    throw new Error(`No text for the ${id} license: add it from the SPDX license list as ${file}`);
  }
  return `### ${id}\n\n${fenced(readFileSync(file, 'utf8'))}`;
}

const files = filesUnder(outputDir);
// Keyed by name and version: a traced package may be bundled too, from another path.
const notices = [
  ...new Map(
    [...bundledPackages(files), ...tracedPackages(files)].map(notice).map((n) => [n.key, n]),
  ).values(),
].sort((a, b) => a.key.localeCompare(b.key));
const licenses = [...new Set(notices.flatMap((n) => n.licenses))].sort();

writeFileSync(
  noticesFile,
  `# Third-party notices

The npm packages this image's JavaScript bundles or ships, each with the license and notice
files it comes with, then the full text of every license they declare. Node.js's own
license, which covers what Node bundles, is \`/usr/local/LICENSE\`; the Alpine packages are
in \`SOURCE-OFFER.md\`. In the app image, the browser app's bundled packages are in
\`/app/public/licenses.txt\`, which the app serves as \`/licenses.txt\`.

${notices.map((n) => n.section).join('\n')}
# License texts

${licenses.map(licenseText).join('\n')}`,
);

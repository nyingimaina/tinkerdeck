// The Rust format and lint gates for an app that existed before the standard.
//
// An older app already has unformatted files and lint warnings, and nobody should have to fix a hundred old ones to ship one feature. So:
//   fmt        fails only on files that rustfmt would change and that were NOT unformatted when the project was adopted (a file is judged by its path).
//   lint       fails only on clippy messages that are NEW compared with a baseline recorded at adoption. Moving an old message to another line is not a new
//              message; a second copy of an old one is. A compile error is never in a baseline.
//   baseline   records what the project has today.
//
//   node rust_gate.mjs fmt  [--manifest src-tauri/Cargo.toml] [--baseline <file>] [--from-file <rustfmt output>]
//   node rust_gate.mjs lint [--manifest src-tauri/Cargo.toml] [--baseline <file>] [--from-file <clippy output>]
//   node rust_gate.mjs baseline fmt|lint --write <file> [--manifest ...] [--from-file <output>]
//
// Without a baseline nothing is excused: that is how a new app is judged.
// Exit codes: 0 nothing new, 1 something new, 2 the output could not be read (a broken tool is never a green gate), 64 wrong use.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.cwd();

/** Forward slashes, and relative to the folder the gate runs in when the path is inside it. */
export function normalize(path) {
  // rustfmt prints Windows paths in their extended form (\\?\C:\...), which no other tool understands.
  const plain = path.trim().replace(/^(\\\\\?\\|\/\/\?\/)/, '');
  const slashed = plain.replaceAll('\\', '/');
  if (/^([A-Za-z]:)?\//.test(slashed)) {
    const rel = relative(root, resolve(plain)).replaceAll('\\', '/');
    if (!rel.startsWith('..')) return rel;
  }
  return slashed.replace(/^\.\//, '');
}

const DIFF = /^Diff in (.+?)(?::| at line )(\d+):?\s*$/;
const MESSAGE = /^(.+?):(\d+):(\d+): (warning|error)(?:\[[^\]]+\])?: (.*)$/;

/** The files rustfmt would change. */
export function parseFmt(text) {
  const files = new Set();
  for (const line of text.replaceAll('\r', '').split('\n')) {
    const m = DIFF.exec(line);
    if (m) files.add(normalize(m[1]));
  }
  return [...files].sort();
}

/** Every clippy message as a fingerprint without its line and column. */
export function parseLint(text) {
  const issues = [];
  for (const line of text.replaceAll('\r', '').split('\n')) {
    const m = MESSAGE.exec(line);
    if (m) issues.push(`${m[4]}|${normalize(m[1])}|${m[5].trim()}`);
  }
  return issues;
}

/** False when the output is not what the tool prints (not installed, a crash): treating that as "no issues" would turn a broken gate green. */
export function understood(tool, text, exit) {
  if (tool === 'fmt') return exit === 0 || parseFmt(text).length > 0;
  return /\bFinished\b/.test(text) || parseLint(text).length > 0 || /could not compile/.test(text) && parseLint(text).length > 0;
}

export function count(items) {
  const counts = new Map();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return counts;
}

export function readBaseline(path) {
  const counts = new Map();
  if (!path || !existsSync(path)) return counts;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const tab = line.indexOf('\t');
    if (tab > 0) counts.set(line.slice(tab + 1), Number(line.slice(0, tab)));
  }
  return counts;
}

export function writeBaseline(path, counts, tool) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  const lines = [`# ${tool} issues the project had when DevTeam adopted it. They are not judged; any other issue is new.`];
  for (const [item, n] of [...counts].sort((a, b) => (a[0] < b[0] ? -1 : 1))) lines.push(`${n}\t${item}`);
  writeFileSync(path, lines.join('\n') + '\n');
}

/** The items beyond what the baseline allows. */
export function fresh(items, baseline) {
  const seen = new Map();
  const result = [];
  for (const item of items) {
    const n = (seen.get(item) ?? 0) + 1;
    seen.set(item, n);
    if (n > (baseline.get(item) ?? 0)) result.push(item);
  }
  return result;
}

function option(args, name) {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
}

function output(tool, args) {
  const from = option(args, 'from-file');
  if (from) return { text: readFileSync(from, 'utf8'), exit: tool === 'fmt' && /Diff in /.test(readFileSync(from, 'utf8')) ? 1 : 0 };
  const manifest = option(args, 'manifest') ?? 'src-tauri/Cargo.toml';
  const command = tool === 'fmt'
    ? `cargo fmt --manifest-path "${manifest}" --check`
    : `cargo clippy --manifest-path "${manifest}" --all-targets --message-format=short`;
  const run = spawnSync(command, { shell: true, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  return { text: `${run.stdout ?? ''}\n${run.stderr ?? ''}`, exit: run.status ?? -1 };
}

function main(args) {
  const verb = args[0];
  const baselineMode = verb === 'baseline';
  const tool = baselineMode ? args[1] : verb;
  if (!['fmt', 'lint'].includes(tool)) {
    console.log('Which gate? Use: rust_gate.mjs fmt | lint | baseline fmt | baseline lint');
    return 64;
  }
  const { text, exit } = output(tool, args);
  if (!understood(tool, text, exit)) {
    console.log(`The ${tool === 'fmt' ? 'rustfmt' : 'clippy'} run did not produce a result, so nothing is proven:`);
    const shown = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 12);
    console.log(shown.length ? shown.join('\n') : '(no output)');
    return 2;
  }
  const items = tool === 'fmt' ? parseFmt(text) : parseLint(text);
  const name = tool === 'fmt' ? 'unformatted file' : 'clippy issue';
  if (baselineMode) {
    const target = option(args, 'write');
    if (!target) { console.log('Say where to write it: --write <file>'); return 64; }
    writeBaseline(target, count(items), tool === 'fmt' ? 'rustfmt' : 'clippy');
    console.log(`Recorded ${items.length} existing ${name}(s) in ${target}.`);
    return 0;
  }
  const baseline = readBaseline(option(args, 'baseline'));
  const added = fresh(items, baseline);
  const known = items.length - added.length;
  if (added.length === 0) {
    console.log(known === 0 ? `No ${name}s.` : `No new ${name}s (${known} old one(s) are in the baseline and are not judged).`);
    return 0;
  }
  console.log(`${added.length} new ${name}(s):`);
  for (const item of added.slice(0, 60)) console.log('  ' + (tool === 'fmt' ? `${item} (run: cargo fmt)` : item.replaceAll('|', ' - ')));
  if (added.length > 60) console.log(`  ... and ${added.length - 60} more`);
  if (known > 0) console.log(`(${known} old one(s) in the baseline were not counted.)`);
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}

// The app has one version number. This fails when package.json, src-tauri/Cargo.toml and src-tauri/tauri.conf.json disagree (rule TAU-013).
// It reads the three files from the folder it is run in and changes nothing.
import { readFileSync } from 'node:fs';

const versions = {};

versions['package.json'] = JSON.parse(readFileSync('package.json', 'utf8')).version;

const cargo = readFileSync('src-tauri/Cargo.toml', 'utf8');
const packageSection = cargo.split(/^\[/m).find((section) => section.startsWith('package]')) ?? '';
versions['src-tauri/Cargo.toml'] = /^version\s*=\s*"([^"]+)"/m.exec(packageSection)?.[1];

versions['src-tauri/tauri.conf.json'] = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')).version;

const missing = Object.entries(versions).filter(([, v]) => !v).map(([file]) => file);
if (missing.length > 0) {
  console.error(`No version found in: ${missing.join(', ')}`);
  process.exit(1);
}
const distinct = new Set(Object.values(versions));
if (distinct.size > 1) {
  console.error('The version is not the same everywhere:');
  for (const [file, version] of Object.entries(versions)) console.error(`  ${file}: ${version}`);
  console.error('Change all three together.');
  process.exit(1);
}
console.log(`Version ${[...distinct][0]} everywhere.`);

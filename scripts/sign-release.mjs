// Writes latest.json and latest.json.sig next to the installer (installer/output), ready to upload as
// release assets. Installed apps fetch these, verify the signature with the public key built into
// the app, check the installer's SHA-256, and only then offer the update.
//
// Usage: node scripts/sign-release.mjs [notes-file] [--version X.Y.Z]
import { createHash, createPrivateKey, sign } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const args = process.argv.slice(2);
const vi = args.indexOf("--version");
const version = vi >= 0 ? args[vi + 1] : pkg.version;
const notesFile = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--version");
const keyFile = process.env.TD_UPDATE_KEY_FILE || join(homedir(), ".lite-commander", "update-signing.key");
const out = join(root, "installer", "output");
const installer = join(out, `Tinkerdeck-Setup-${version}.exe`);

if (!existsSync(keyFile)) {
  console.error(`No signing key at ${keyFile}. Run: node scripts/new-update-key.mjs`);
  process.exit(1);
}
if (!existsSync(installer)) {
  console.error(`Installer not found: ${installer}. Run npm run installer first.`);
  process.exit(1);
}

// TD_RELEASE_URL_BASE is for testing against a local server (the app must be started with TINKERDECK_UPDATE_BASE).
const urlBase = (process.env.TD_RELEASE_URL_BASE || `https://github.com/nyingimaina/tinkerdeck/releases/download/v${version}`).replace(/\/$/, "");

const bytes = readFileSync(installer);
// notes: an explicit file, otherwise this version's section of CHANGELOG.md (what people see in the update dialog)
function changelogSection(v) {
  const file = join(root, "CHANGELOG.md");
  if (!existsSync(file)) return "";
  const m = readFileSync(file, "utf8").replace(/\r\n/g, "\n").match(new RegExp(`^## ${v.replace(/\./g, "\\.")}\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, "m"));
  return m ? m[1].trim() : "";
}
const notes = notesFile && existsSync(notesFile) ? readFileSync(notesFile, "utf8").trim() : changelogSection(version);
const manifest = {
  version,
  notes: notes.slice(0, 4000),
  url: `${urlBase}/Tinkerdeck-Setup-${version}.exe`,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  size: statSync(installer).size,
};
const json = JSON.stringify(manifest, null, 2) + "\n";
const signature = sign(null, Buffer.from(json), createPrivateKey(readFileSync(keyFile))).toString("base64");
writeFileSync(join(out, "latest.json"), json);
writeFileSync(join(out, "latest.json.sig"), signature + "\n");
console.log(`signed ${version}: latest.json + latest.json.sig written to ${out}`);
console.log(`sha256 ${manifest.sha256}`);

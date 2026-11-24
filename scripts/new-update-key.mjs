// Creates the ed25519 key pair that signs update manifests.
// The PRIVATE key is written to your profile (never into the repository) and must be backed up:
// without it you cannot publish updates that installed copies will accept.
// Prints the PUBLIC key (raw, base64) to paste into src-tauri/src/update.rs (PUBLIC_KEY_B64).
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const defaultKeyFile = () => process.env.TD_UPDATE_KEY_FILE || join(homedir(), ".lite-commander", "update-signing.key");

const file = defaultKeyFile();
if (existsSync(file)) {
  console.error(`A signing key already exists at ${file}. Refusing to overwrite it.`);
  process.exit(1);
}
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
const raw = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
console.log(`private key written to ${file}`);
console.log(`PUBLIC_KEY_B64 = ${raw}`);

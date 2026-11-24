// Types shared with Rust, plus pure helpers. The UI only displays what Rust reports.

export type TermState =
  | { kind: "stopped" }
  | { kind: "starting" }
  | { kind: "running" }
  | { kind: "detached" }
  | { kind: "stopping" }
  | { kind: "exited"; code: number }
  | { kind: "failedToStart"; reason: string };

export interface TerminalDef {
  id: string;
  name: string;
  cwd: string;
  command: string;
  stopCommand?: string;
  env: Record<string, string>;
  /** Shell id for this terminal only; omitted = the app-wide default. */
  shell?: string;
}

export interface AppDef {
  id: string;
  name: string;
  root: string;
  terminals: TerminalDef[];
  favourite?: boolean;
  /** Unix seconds of the last time the app was opened or started. */
  lastOpened?: number;
}

export interface UpdateSettings {
  autoCheck: boolean;
  skippedVersion?: string;
  lastChecked: number;
}

export interface UpdateInfo {
  version: string;
  notes: string;
  url: string;
  sha256: string;
  size: number;
}

export interface Config {
  version: number;
  theme: "light" | "dark";
  shell: string;
  lastRunning: string[];
  apps: AppDef[];
  update?: UpdateSettings;
}

export interface ConfigStatus {
  locked: boolean;
  permanent: boolean;
  message: string | null;
  path: string;
}

export interface ConfigView {
  config: Config;
  status: ConfigStatus;
  jobWarning: string | null;
}

export interface StatePayload {
  terminalId: string;
  appId: string;
  state: TermState;
}

export type DotKind = "grey" | "greyTick" | "green" | "greenHollow" | "amber" | "red";

export const canStart = (s: TermState) => s.kind === "stopped" || s.kind === "exited" || s.kind === "failedToStart";
export const canStop = (s: TermState) => s.kind === "running" || s.kind === "detached";
export const isUp = (s: TermState) => s.kind === "running" || s.kind === "starting" || s.kind === "detached";
export const isFailed = (s: TermState) =>
  s.kind === "failedToStart" || (s.kind === "exited" && s.code !== 0);

export function dotKind(s: TermState): DotKind {
  switch (s.kind) {
    case "running":
      return "green";
    case "detached":
      return "greenHollow";
    case "starting":
    case "stopping":
      return "amber";
    case "exited":
      return s.code === 0 ? "greyTick" : "red";
    case "failedToStart":
      return "red";
    default:
      return "grey";
  }
}

export function stateLabel(s: TermState): string {
  switch (s.kind) {
    case "running":
      return "Running";
    case "starting":
      return "Starting";
    case "stopping":
      return "Stopping";
    case "detached":
      return "Detached: started something that keeps running (use Stop to run the stop command)";
    case "exited":
      return `Exited with code ${s.code}`;
    case "failedToStart":
      return s.reason;
    default:
      return "Stopped";
  }
}

export type Rollup = "grey" | "green" | "amber" | "red";

export function rollup(states: TermState[]): Rollup {
  if (states.length === 0) return "grey";
  if (states.some(isFailed)) return "red";
  const up = states.filter(isUp).length;
  if (up === states.length) return "green";
  if (up > 0 || states.some((s) => s.kind === "stopping")) return "amber";
  return "grey";
}

export function appButton(states: TermState[]): "start" | "stop" {
  return states.some(isUp) ? "stop" : "start";
}

// ------------------------------------------------------------ ids and forms

export function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const newTerminal = (): TerminalDef => ({ id: uuid(), name: "", cwd: ".", command: "", env: {} });
export const newApp = (): AppDef => ({ id: uuid(), name: "", root: "", terminals: [] });

export const MAX_NAME = 40;

export function duplicateNames(terminals: TerminalDef[]): string[] {
  const seen = new Map<string, number>();
  for (const t of terminals) {
    const k = t.name.trim().toLowerCase();
    if (k) seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
}

export interface Validation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function validateApp(app: AppDef): Validation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const check = (name: string, what: string) => {
    const n = name.trim().length;
    if (n === 0) errors.push(`${what} name is required.`);
    else if (n > MAX_NAME) errors.push(`${what} name must be at most ${MAX_NAME} characters.`);
  };
  check(app.name, "App");
  app.terminals.forEach((t, i) => check(t.name, `Terminal ${i + 1}`));
  for (const d of duplicateNames(app.terminals)) warnings.push(`Two terminals are called "${d}".`);
  return { ok: errors.length === 0, errors, warnings };
}

export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i <= 0) continue;
    const k = line.slice(0, i).trim();
    if (!k || /\s/.test(k)) continue;
    out[k] = line.slice(i + 1).trim();
  }
  return out;
}

export const formatEnv = (env: Record<string, string>) =>
  Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

export const normalizeSlashes = (p: string) => p.trim().replace(/^"|"$/g, "").replace(/\//g, "\\");

// ------------------------------------------------- novice helpers (no typing)

export interface Suggestion {
  name: string;
  cwd: string;
  command: string;
  stopCommand: string | null;
  kind: string;
  primary: boolean;
}

/** `docker start X` -> `docker stop X`, `docker compose up` -> `docker compose down`. */
export function deriveStopCommand(command: string): string | null {
  const c = command.trim().replace(/\s+/g, " ");
  let m = /^docker start (\S+)$/i.exec(c);
  if (m) return `docker stop ${m[1]}`;
  m = /^(docker compose|docker-compose) up\b/i.exec(c);
  if (m) return `${m[1]} down`;
  return null;
}

export function nameFromPath(p: string): string {
  const parts = p.trim().replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] ?? "";
}

const isAbsolute = (p: string) => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("\\\\");

export function joinPath(root: string, cwd: string): string {
  const r = normalizeSlashes(root).replace(/\\+$/, "");
  const c = normalizeSlashes(cwd);
  if (!c || c === ".") return r;
  if (isAbsolute(c)) return c;
  return `${r}\\${c}`;
}

export function folderOptions(subfolders: string[], current: string): string[] {
  const out = [".", ...subfolders];
  const cur = current.trim();
  if (cur && !out.includes(cur)) out.push(cur);
  return out;
}

export function uniqueName(base: string, existing: string[]): string {
  const taken = new Set(existing.map((n) => n.trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  let i = 2;
  while (taken.has(`${base} ${i}`.toLowerCase())) i++;
  return `${base} ${i}`;
}

export function suggestionToTerminal(s: Suggestion): TerminalDef {
  return {
    ...newTerminal(),
    name: s.name,
    cwd: s.cwd || ".",
    command: s.command,
    stopCommand: s.stopCommand ?? undefined,
  };
}

export const COMMON_COMMANDS = [
  "npm run dev",
  "npm start",
  "npm run build",
  "yarn dev",
  "pnpm dev",
  "dotnet watch run",
  "dotnet run",
  "docker compose up",
  "python main.py",
  "cargo run",
  "go run .",
];

export const TERMINAL_NAMES = ["api", "frontend", "backend", "db", "web", "worker", "queue", "cache", "shell"];

export function commandOptions(detected: Suggestion[], containers: string[]): string[] {
  const all = [...detected.map((d) => d.command), ...containers.map((c) => `docker start ${c}`), ...COMMON_COMMANDS];
  return all.filter((c, i) => all.indexOf(c) === i);
}

export interface Template {
  id: string;
  label: string;
  make: (containers: string[]) => Partial<TerminalDef>;
}

export const TEMPLATES: Template[] = [
  { id: "shell", label: "Plain PowerShell", make: () => ({ name: "shell", command: "" }) },
  { id: "node", label: "Web front end (npm run dev)", make: () => ({ name: "frontend", command: "npm run dev" }) },
  { id: "dotnet", label: ".NET API (dotnet watch run)", make: () => ({ name: "api", command: "dotnet watch run" }) },
  {
    id: "docker",
    label: "Docker container (start / stop)",
    make: (containers) => {
      const name = containers[0] ?? "";
      return {
        name: "db",
        command: name ? `docker start ${name}` : "docker start ",
        stopCommand: name ? `docker stop ${name}` : undefined,
      };
    },
  },
  {
    id: "compose",
    label: "Docker Compose (up / down)",
    make: () => ({ name: "compose", command: "docker compose up", stopCommand: "docker compose down" }),
  },
  { id: "python", label: "Python script", make: () => ({ name: "app", command: "python main.py" }) },
];

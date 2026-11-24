// Thin wrappers around Tauri `invoke`, events and the dialog plugin. Nothing else in the UI imports Tauri.
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { AppDef, ConfigView, StatePayload, Suggestion } from "../state/model";
import type { Branches, CommitFile, CommitInfo, FileChange, RepoInfo } from "../state/git";

export interface ShellInfo {
  id: string;
  name: string;
  path: string;
}

export const api = {
  getConfig: () => invoke<ConfigView>("get_config"),
  saveApps: (apps: AppDef[]) => invoke<void>("save_apps", { apps }),
  setTheme: (theme: string) => invoke<void>("set_theme", { theme }),
  setShell: (shell: string) => invoke<void>("set_shell", { shell }),
  setLastRunning: (ids: string[]) => invoke<void>("set_last_running", { ids }),
  ackConfig: () => invoke<void>("ack_config"),
  terminalStates: () => invoke<StatePayload[]>("terminal_states"),
  startTerminal: (appId: string, terminalId: string) => invoke<void>("start_terminal", { appId, terminalId }),
  stopTerminal: (appId: string, terminalId: string) => invoke<void>("stop_terminal", { appId, terminalId }),
  restartTerminal: (appId: string, terminalId: string) => invoke<void>("restart_terminal", { appId, terminalId }),
  startAll: (appId: string) => invoke<void>("start_all", { appId }),
  stopAll: (appId: string) => invoke<void>("stop_all", { appId }),
  writeInput: (terminalId: string, data: number[]) => invoke<void>("write_input", { terminalId, data }),
  resize: (terminalId: string, cols: number, rows: number) => invoke<void>("resize", { terminalId, cols, rows }),
  openConfigFolder: () => invoke<void>("open_config_folder"),
  quitApp: (stop: boolean) => invoke<void>("quit_app", { stop }),
  detectProject: (root: string) => invoke<Suggestion[]>("detect_project", { root }),
  suggestCommands: (folder: string) => invoke<Suggestion[]>("suggest_commands", { folder }),
  listSubfolders: (root: string) => invoke<string[]>("list_subfolders", { root }),
  dockerContainers: () => invoke<string[]>("docker_containers"),
  listShells: () => invoke<ShellInfo[]>("list_shells"),
  setFavourite: (appId: string, favourite: boolean) => invoke<void>("set_favourite", { appId, favourite }),
  touchApp: (appId: string) => invoke<void>("touch_app", { appId }),
  pathsExist: (paths: string[]) => invoke<boolean[]>("paths_exist", { paths }),
  gitInfo: (appId: string) => invoke<RepoInfo | null>("git_info", { appId }),
  gitChanges: (appId: string) => invoke<FileChange[]>("git_changes", { appId }),
  gitBranches: (appId: string) => invoke<Branches>("git_branches", { appId }),
  gitSwitch: (appId: string, branch: string) => invoke<void>("git_switch", { appId, branch }),
  gitCommit: (appId: string, paths: string[], message: string) => invoke<string>("git_commit", { appId, paths, message }),
  gitLog: (appId: string, limit: number) => invoke<CommitInfo[]>("git_log", { appId, limit }),
  gitCommitFiles: (appId: string, hash: string) => invoke<CommitFile[]>("git_commit_files", { appId, hash }),
  gitFetch: (appId: string) => invoke<string>("git_fetch", { appId }),
  gitPull: (appId: string) => invoke<string>("git_pull", { appId }),
  gitPush: (appId: string) => invoke<string>("git_push", { appId }),
  gitSync: (appId: string) => invoke<string>("git_sync", { appId }),
};

/** Replay the buffered output, then stream live output as raw bytes. */
export function attachTerminal(appId: string, terminalId: string, onData: (bytes: Uint8Array) => void) {
  const channel = new Channel<ArrayBuffer>();
  channel.onmessage = (buf) => onData(new Uint8Array(buf));
  return invoke<void>("attach", { appId, terminalId, onOutput: channel });
}

export const onTerminalState = (cb: (p: StatePayload) => void): Promise<UnlistenFn> =>
  listen<StatePayload>("terminal-state", (e) => cb(e.payload));

export const onCloseRequested = (cb: (running: number) => void): Promise<UnlistenFn> =>
  listen<{ running: number }>("close-requested", (e) => cb(e.payload.running));

export async function pickFolder(defaultPath?: string): Promise<string | null> {
  const r = await open({ directory: true, multiple: false, defaultPath });
  return typeof r === "string" ? r : null;
}

export const errorText = (e: unknown): string => (typeof e === "string" ? e : e instanceof Error ? e.message : String(e));

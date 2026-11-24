import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigView, UpdateInfo } from "./state/model";

const h = vi.hoisted(() => ({
  view: null as unknown,
  info: null as unknown,
  fail: null as string | null,
  api: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock("./api/tauri", () => {
  for (const n of [
    "saveApps", "setTheme", "setShell", "setLastRunning", "ackConfig", "startTerminal", "stopTerminal", "restartTerminal",
    "startAll", "stopAll", "writeInput", "resize", "openConfigFolder", "quitApp", "touchApp", "setFavourite", "setUpdateSettings",
    "downloadUpdate", "applyUpdate",
  ]) h.api[n] = vi.fn(async () => undefined);
  for (const n of ["detectProject", "suggestCommands", "listSubfolders", "dockerContainers", "listShells"]) h.api[n] = vi.fn(async () => []);
  h.api.getConfig = vi.fn(async () => h.view);
  h.api.terminalStates = vi.fn(async () => []);
  h.api.pathsExist = vi.fn(async (p: string[]) => p.map(() => true));
  h.api.gitInfo = vi.fn(async () => null);
  h.api.checkUpdate = vi.fn(async (force: boolean) => {
    if (force && h.fail) throw h.fail;
    return force ? h.info : null; // the quiet automatic check finds nothing; only the button looks
  });
  return {
    api: h.api,
    attachTerminal: vi.fn(async () => undefined),
    onTerminalState: vi.fn(async () => () => {}),
    onCloseRequested: vi.fn(async () => () => {}),
    onUpdateProgress: vi.fn(async () => () => {}),
    pickFolder: vi.fn(async () => null),
    errorText: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  };
});
vi.mock("./api/editor", () => ({ editorApi: { list: vi.fn(async () => ({ open: [], bin: [] })), takePending: vi.fn(async () => []), onOpen: vi.fn(async () => () => {}) } }));
vi.mock("./features/terminals/TerminalHost", () => ({ TerminalHost: () => <div /> }));

import { App } from "./App";

const info: UpdateInfo = { version: "9.9.9", notes: "New things.", url: "https://x/y.exe", sha256: "a".repeat(64), size: 4_200_000 };
const view = (): ConfigView => ({
  config: {
    version: 1, theme: "dark", shell: "powershell.exe", lastRunning: [],
    apps: [{ id: "a1", name: "Qonsol", root: "E:\\q", terminals: [{ id: "t1", name: "api", cwd: ".", command: "", env: {} }] }],
  },
  status: { locked: false, permanent: false, message: null, path: "C:\\cfg.json" },
  jobWarning: null,
});

beforeEach(() => {
  Object.values(h.api).forEach((f) => f.mockClear());
  h.view = view();
  h.info = null;
  h.fail = null;
});

describe("manual update check from the header", () => {
  it("is one click away and says so when you are up to date", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await userEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText(/latest version/i)).toBeTruthy();
    expect(h.api.checkUpdate).toHaveBeenCalledWith(true);
  });

  it("shows the update banner when there is a newer version", async () => {
    h.info = info;
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await userEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText(/is available\./)).toHaveTextContent("9.9.9");
    expect(screen.queryByText(/latest version/i)).toBeNull();
  });

  it("explains a failure in plain words and lets you dismiss it", async () => {
    h.fail = "Could not reach the update server.";
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await userEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText(/Could not reach the update server/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByText(/Could not reach the update server/)).toBeNull());
  });

  it("does not run when you have not pressed it: the quiet check never shows a message", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await waitFor(() => expect(h.api.checkUpdate).toHaveBeenCalledWith(false));
    expect(screen.queryByText(/latest version/i)).toBeNull();
  });
});

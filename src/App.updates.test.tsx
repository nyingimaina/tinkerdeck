import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigView, UpdateInfo } from "./state/model";

const h = vi.hoisted(() => ({
  view: null as unknown,
  states: [] as unknown[],
  info: null as unknown,
  api: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock("./api/tauri", () => {
  const names = [
    "saveApps", "setTheme", "setShell", "setLastRunning", "ackConfig", "startTerminal", "stopTerminal", "restartTerminal",
    "startAll", "stopAll", "writeInput", "resize", "openConfigFolder", "quitApp", "touchApp", "setFavourite", "setUpdateSettings",
    "downloadUpdate", "applyUpdate",
  ];
  for (const n of names) h.api[n] = vi.fn(async () => undefined);
  for (const n of ["detectProject", "suggestCommands", "listSubfolders", "dockerContainers", "listShells"]) h.api[n] = vi.fn(async () => []);
  h.api.getConfig = vi.fn(async () => h.view);
  h.api.terminalStates = vi.fn(async () => h.states);
  h.api.pathsExist = vi.fn(async (p: string[]) => p.map(() => true));
  h.api.gitInfo = vi.fn(async () => null);
  h.api.checkUpdate = vi.fn(async () => h.info);
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

vi.mock("./features/terminals/TerminalHost", () => ({ TerminalHost: () => <div /> }));

// The Files explorer reads one level per root; a quiet empty listing keeps these suites as they were (A3).
vi.mock("./api/explorer", () => ({
  explorerApi: {
    list: vi.fn(async (path: string) => ({ path, entries: [], total: 0, truncated: false, locked: false })),
    drives: vi.fn(async () => []),
  },
}));

import { App } from "./App";

/** Help now lives in the Utilities menu. */
async function openHelp() {
  await userEvent.click(screen.getByRole("button", { name: "Utilities" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Help" }));
}

const T = (id: string, name: string) => ({ id, name, cwd: ".", command: "", env: {} });
const info: UpdateInfo = { version: "1.3.0", notes: "Faster.\nFewer bugs.", url: "https://x/y.exe", sha256: "a".repeat(64), size: 4_200_000 };
const view = (update?: { autoCheck: boolean; skippedVersion?: string; lastChecked: number }): ConfigView => ({
  config: {
    version: 1, theme: "dark", shell: "powershell.exe", lastRunning: [],
    apps: [{ id: "a1", name: "Qonsol", root: "E:\\q", terminals: [T("t1", "api"), T("t2", "web")] }],
    ...(update ? { update } : {}),
  },
  status: { locked: false, permanent: false, message: null, path: "C:\\cfg.json" },
  jobWarning: null,
});

beforeEach(() => {
  Object.values(h.api).forEach((f) => f.mockClear());
  h.api.downloadUpdate.mockResolvedValue("C:\\x.exe");
  h.api.applyUpdate.mockResolvedValue(undefined);
  h.view = view();
  h.states = [];
  h.info = null;
});

const banner = () => screen.queryByText(/is available\./);

describe("self-update in the app", () => {
  it("shows no banner when there is nothing new", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await waitFor(() => expect(h.api.checkUpdate).toHaveBeenCalledWith(false));
    expect(banner()).toBeNull();
  });

  it("a quiet check at launch shows the banner with the version", async () => {
    h.info = info;
    render(<App />);
    expect(await screen.findByText(/is available\./)).toHaveTextContent("1.3.0");
    expect(h.api.checkUpdate).toHaveBeenCalledWith(false);
    expect(h.api.downloadUpdate).not.toHaveBeenCalled(); // nothing happens without the user
  });

  it("Update now opens the notes, and confirming downloads first and then installs", async () => {
    h.info = info;
    const order: string[] = [];
    h.api.downloadUpdate.mockImplementation(async () => void order.push("download"));
    h.api.applyUpdate.mockImplementation(async () => void order.push("apply"));
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Update now" }));
    const dlg = await screen.findByRole("dialog", { name: "Update to 1.3.0" });
    expect(dlg).toHaveTextContent("Fewer bugs");
    await userEvent.click(screen.getByRole("button", { name: "Update and restart" }));
    await waitFor(() => expect(order).toEqual(["download", "apply"]));
    expect(await screen.findByText(/Installing\./)).toBeInTheDocument();
  });

  it("warns how many running terminals the update will stop", async () => {
    h.info = info;
    h.states = [
      { terminalId: "t1", appId: "a1", state: { kind: "running" } },
      { terminalId: "t2", appId: "a1", state: { kind: "running" } },
    ];
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Update now" }));
    expect(await screen.findByText(/2 terminals are running/)).toBeInTheDocument();
  });

  it("a failed download shows why, offers retry, and never applies", async () => {
    h.info = info;
    h.api.downloadUpdate.mockRejectedValue("The downloaded update does not match its checksum and was discarded.");
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Update now" }));
    await userEvent.click(await screen.findByRole("button", { name: "Update and restart" }));
    const dlg = screen.getByRole("dialog", { name: "Update to 1.3.0" });
    expect(await within(dlg).findByRole("alert")).toHaveTextContent("checksum");
    expect(h.api.applyUpdate).not.toHaveBeenCalled();
    expect(within(dlg).getByRole("button", { name: "Update and restart" })).toBeEnabled();
  });

  it("Cancel closes the dialog but keeps the banner; Later hides the banner", async () => {
    h.info = info;
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Update now" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Update to 1.3.0" })).toBeNull();
    expect(banner()).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(banner()).toBeNull();
  });

  it("Skip this version saves it and hides the banner", async () => {
    h.info = info;
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Skip this version" }));
    expect(h.api.setUpdateSettings).toHaveBeenCalledWith({ skippedVersion: "1.3.0" });
    await waitFor(() => expect(banner()).toBeNull());
  });

  it("a version that was skipped earlier stays hidden", async () => {
    h.info = info;
    h.view = view({ autoCheck: true, skippedVersion: "1.3.0", lastChecked: 1 });
    render(<App />);
    await waitFor(() => expect(h.api.checkUpdate).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 100));
    expect(banner()).toBeNull();
  });

  it("with automatic checks off nothing is requested at launch", async () => {
    h.view = view({ autoCheck: false, lastChecked: 1 });
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await new Promise((r) => setTimeout(r, 150));
    expect(h.api.checkUpdate).not.toHaveBeenCalled();
  });

  it("Help shows the version, a Check now button and the automatic switch", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openHelp();
    const dlg = await screen.findByRole("dialog", { name: "Help" }, { timeout: 5000 });
    expect(within(dlg).getByText(/^Version \d+\.\d+\.\d+/)).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole("button", { name: "Check now" }));
    await waitFor(() => expect(h.api.checkUpdate).toHaveBeenCalledWith(true));
    expect(await within(dlg).findByText("You are up to date.")).toBeInTheDocument();
    await userEvent.click(within(dlg).getByLabelText(/Check for updates automatically/));
    expect(h.api.setUpdateSettings).toHaveBeenCalledWith({ autoCheck: false });
  });

  it("a manual check that fails says so in plain words", async () => {
    h.api.checkUpdate.mockImplementation(async (force: boolean) => {
      if (force) throw new Error("Could not reach the update server.");
      return null;
    });
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openHelp();
    const dlg = await screen.findByRole("dialog", { name: "Help" }, { timeout: 5000 });
    await userEvent.click(within(dlg).getByRole("button", { name: "Check now" }));
    expect(await within(dlg).findByText("Could not reach the update server.")).toBeInTheDocument();
  });

  it("a manual check that finds an update brings the banner up", async () => {
    h.api.checkUpdate.mockImplementation(async (force: boolean) => (force ? info : null));
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openHelp();
    const dlg = await screen.findByRole("dialog", { name: "Help" }, { timeout: 5000 });
    await userEvent.click(within(dlg).getByRole("button", { name: "Check now" }));
    expect(await within(dlg).findByText("Version 1.3.0 is available.")).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole("button", { name: "Close" }));
    expect(await screen.findByText(/is available\./)).toBeInTheDocument();
  });
});

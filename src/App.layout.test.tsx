import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigView } from "./state/model";

const h = vi.hoisted(() => ({
  view: null as unknown,
  states: [] as unknown[],
  repo: null as unknown,
  api: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock("./api/tauri", () => {
  const names = [
    "saveApps", "setTheme", "setShell", "setLastRunning", "ackConfig", "startTerminal", "stopTerminal", "restartTerminal",
    "startAll", "stopAll", "writeInput", "resize", "openConfigFolder", "quitApp", "touchApp", "setFavourite", "checkUpdate",
    "downloadUpdate", "applyUpdate", "setUpdateSettings", "gitSwitch", "gitFetch", "gitPull", "gitPush", "gitSync",
  ];
  for (const n of names) h.api[n] = vi.fn(async () => undefined);
  for (const n of ["detectProject", "suggestCommands", "listSubfolders", "dockerContainers", "gitChanges", "gitLog", "gitCommitFiles"])
    h.api[n] = vi.fn(async () => []);
  h.api.getConfig = vi.fn(async () => h.view);
  h.api.terminalStates = vi.fn(async () => h.states);
  h.api.pathsExist = vi.fn(async (p: string[]) => p.map(() => true));
  h.api.gitInfo = vi.fn(async () => h.repo);
  h.api.listShells = vi.fn(async () => [
    { id: "powershell.exe", name: "Windows PowerShell", path: "a" },
    { id: "pwsh.exe", name: "PowerShell 7", path: "b" },
  ]);
  return {
    api: h.api,
    attachTerminal: vi.fn(async () => undefined),
    onUpdateProgress: vi.fn(async () => () => {}),
    onTerminalState: vi.fn(async () => () => {}),
    onCloseRequested: vi.fn(async () => () => {}),
    pickFolder: vi.fn(async () => null),
    errorText: (e: unknown) => String(e),
  };
});

vi.mock("./features/terminals/TerminalHost", () => ({
  TerminalHost: ({ terminalId, visible }: { terminalId: string; visible: boolean }) => (
    <div data-testid={`host-${terminalId}`} data-visible={String(visible)} />
  ),
}));

import { App } from "./App";

const T = (id: string, name: string) => ({ id, name, cwd: ".", command: "", env: {} });
const view = (apps = [{ id: "a1", name: "Qonsol", root: "E:\\q", terminals: [T("t1", "api"), T("t2", "web")] }]): ConfigView => ({
  config: { version: 1, theme: "dark", shell: "powershell.exe", lastRunning: [], apps },
  status: { locked: false, permanent: false, message: null, path: "C:\\cfg.json" },
  jobWarning: null,
});
const repo = (o: object = {}) => ({
  toplevel: "E:\\q", branch: "main", detached: false, head: "abc1234", dirty: false, hasUpstream: true, ahead: 0, behind: 0, ...o,
});

async function openApp(name = "Qonsol") {
  const buttons = await screen.findAllByRole("button", { name: `Open ${name}` });
  await userEvent.click(buttons[0]);
  await screen.findByRole("heading", { name, level: 2 });
}

async function expandGit() {
  await userEvent.click(await screen.findByRole("button", { name: "Show git tools" }));
}

beforeEach(() => {
  Object.values(h.api).forEach((f) => f.mockClear());
  h.view = view();
  h.states = [];
  h.repo = null;
  localStorage.clear();
});

describe("Palette and remembered layout", () => {
  it("R6: the footer toggle and Ctrl+B keep the sidebar and footer in step, and the footer stays while tools are hidden", async () => {
    h.repo = repo();
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    const toggle = () => screen.getByRole("button", { name: "Toggle sidebar" });
    expect(toggle()).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(toggle());
    expect(screen.getByRole("navigation", { name: "Apps (collapsed)" })).toBeInTheDocument();
    expect(toggle()).toHaveAttribute("aria-pressed", "true");

    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(screen.getByRole("navigation", { name: "Apps" })).toBeInTheDocument();
    expect(toggle()).toHaveAttribute("aria-pressed", "false");

    await openApp();
    await expandGit();
    await userEvent.click(await screen.findByRole("button", { name: "Hide git tools" }));
    expect(screen.queryByRole("button", { name: /Fetch/ })).toBeNull();
    expect(screen.getByRole("contentinfo", { name: "Status" })).toBeInTheDocument();
  });

  it("R7: the palette lists app-level commands and shows an empty result when a query matches none", async () => {
    h.repo = repo();
    render(<App />);
    await openApp();
    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    for (const name of [/Toggle sidebar/, /Reset layout/, /Edit app/, /Open console/]) {
      expect(within(dialog).getByRole("button", { name })).toBeInTheDocument();
    }
    await userEvent.type(within(dialog).getByLabelText("Search commands"), "no-such-command");
    expect(within(dialog).getByText("No commands match.")).toBeInTheDocument();
  });

  it("R8: Reset layout returns the calm default without stopping a running terminal", async () => {
    h.repo = repo({ dirty: true });
    h.api.gitChanges = vi.fn(async () => [{ path: "a.txt", status: "M", staged: false, conflict: false }]);
    h.states = [{ terminalId: "t1", appId: "a1", state: { kind: "running" } }];
    render(<App />);
    await openApp();
    await userEvent.click(screen.getByRole("button", { name: "Toggle sidebar" }));
    await expandGit();
    await userEvent.click(await screen.findByRole("button", { name: /Changes/ }));
    expect(await screen.findByRole("complementary", { name: "Git" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /Console/ }));
    await waitFor(() => expect(h.api.startTerminal).toHaveBeenCalledWith("a1", "console-a1:1"));

    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    await userEvent.click(within(dialog).getByRole("button", { name: /Reset layout/ }));

    expect(screen.getByRole("navigation", { name: "Apps" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Toggle sidebar" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("complementary", { name: "Git" })).toBeNull();
    expect(screen.queryByRole("complementary", { name: "Consoles" })).toBeNull();
    expect(screen.getByTestId("host-console-a1:1")).toHaveAttribute("data-visible", "false");
    expect(screen.getByTestId("host-t1")).toHaveAttribute("data-visible", "true");
    expect(screen.getByRole("button", { name: "Show git tools" })).toBeInTheDocument();
    expect(h.api.stopTerminal).not.toHaveBeenCalled();
  });

  it("R8: hiding the git drawer keeps an in-progress commit message when it is reopened", async () => {
    h.repo = repo({ dirty: true });
    h.api.gitChanges = vi.fn(async () => [{ path: "a.txt", status: "M", staged: false, conflict: false }]);
    render(<App />);
    await openApp();
    await expandGit();
    await userEvent.click(await screen.findByRole("button", { name: /Changes/ }));
    const box = await screen.findByLabelText("Commit message");
    await userEvent.type(box, "wip: keep me");
    expect(box).toHaveValue("wip: keep me");

    await userEvent.click(screen.getByRole("button", { name: "Close git panel" }));
    expect(screen.queryByRole("complementary", { name: "Git" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /Changes/ }));
    expect(await screen.findByLabelText("Commit message")).toHaveValue("wip: keep me");
  });

  it("R8: closing the git drawer returns focus to the Changes control instead of the hidden Close button", async () => {
    h.repo = repo({ dirty: true });
    h.api.gitChanges = vi.fn(async () => [{ path: "a.txt", status: "M", staged: false, conflict: false }]);
    render(<App />);
    await openApp();
    await expandGit();

    const changes = await screen.findByRole("button", { name: /Changes/ });
    await userEvent.click(changes);
    const drawer = await screen.findByRole("complementary", { name: "Git" });
    const close = within(drawer).getByRole("button", { name: "Close git panel" });
    await userEvent.click(close);
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Git" })).toBeNull());

    expect(changes).toHaveFocus();
    expect(close).not.toHaveFocus();
  });

  it("R8: a console that is the only workspace cannot be hidden, so Reset layout leaves it on screen", async () => {
    h.view = view([{ id: "a1", name: "Empty", root: "C:\\e", terminals: [] }]);
    render(<App />);
    await openApp("Empty");
    await userEvent.click(screen.getByRole("tab", { name: /Console/ }));
    await waitFor(() => expect(h.api.startTerminal).toHaveBeenCalledWith("a1", "console-a1:1"));

    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    const hideConsole = within(dialog).getByRole("button", { name: /Hide console/ });
    expect(hideConsole).toBeDisabled();
    expect(hideConsole).toHaveTextContent("Only workspace");
    await userEvent.click(within(dialog).getByRole("button", { name: /Reset layout/ }));
    expect(screen.getByTestId("host-console-a1:1")).toHaveAttribute("data-visible", "true");
    expect(screen.getByRole("complementary", { name: "Consoles" })).toBeInTheDocument();
  });

  it("R8: Reset layout leaves banners without a Dismiss action on screen", async () => {
    h.view = {
      ...view(),
      status: { locked: true, permanent: false, message: "Config problem", path: "C:\\cfg.json" },
      jobWarning: "A job could not be cleaned up",
    };
    render(<App />);
    await screen.findByText(/Config problem/);
    expect(screen.getByText("A job could not be cleaned up")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    await userEvent.click(within(dialog).getByRole("button", { name: /Reset layout/ }));

    expect(screen.getByText(/Config problem/)).toBeInTheDocument();
    expect(screen.getByText("A job could not be cleaned up")).toBeInTheDocument();
  });

  it("R8: Reset layout does not close an app edit form or discard its unsaved input", async () => {
    render(<App />);
    await openApp();
    await userEvent.click(screen.getByRole("button", { name: "Edit Qonsol" }));
    const nameInput = await screen.findByLabelText("App name");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Renamed");

    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    await userEvent.click(within(dialog).getByRole("button", { name: /Reset layout/ }));

    expect(screen.getByRole("complementary", { name: "Edit app" })).toBeInTheDocument();
    expect(screen.getByLabelText("App name")).toHaveValue("Renamed");
  });

  it("R9: the sidebar state survives a restart and a corrupt saved value falls back to the calm default", async () => {
    const first = render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await userEvent.click(screen.getByRole("button", { name: "Toggle sidebar" }));
    expect(screen.getByRole("navigation", { name: "Apps (collapsed)" })).toBeInTheDocument();
    first.unmount();

    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    expect(screen.getByRole("navigation", { name: "Apps (collapsed)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Toggle sidebar" })).toHaveAttribute("aria-pressed", "true");
  });

  it("R9: an unreadable saved layout does not stop the app and starts expanded", async () => {
    localStorage.setItem("td.sidebarCollapsed", "\u0000not-a-flag");
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    expect(screen.getByRole("navigation", { name: "Apps" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Toggle sidebar" })).toHaveAttribute("aria-pressed", "false");
  });

  it("R9: a console open at close is not restarted and its old output is not restored", async () => {
    h.repo = repo();
    const first = render(<App />);
    await openApp();
    await userEvent.click(screen.getByRole("tab", { name: /Console/ }));
    await waitFor(() => expect(h.api.startTerminal).toHaveBeenCalledWith("a1", "console-a1:1"));
    expect(screen.getByTestId("host-console-a1:1")).toHaveAttribute("data-visible", "true");
    first.unmount();
    h.api.startTerminal.mockClear();

    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openApp();
    // The console is session-only: no shell is started again and its host (scrollback) is gone.
    expect(screen.queryByTestId("host-console-a1:1")).toBeNull();
    expect(screen.getByTestId("host-t1")).toHaveAttribute("data-visible", "true");
    expect(h.api.startTerminal).not.toHaveBeenCalled();
  });

  it("R9: a dialog, branch menu, theme finder, edit form and banner open at close are not reopened on restart", async () => {
    h.repo = repo();
    const first = render(<App />);
    await openApp();

    await userEvent.click(screen.getByRole("button", { name: /Switch branch, current main/ }));
    expect(await screen.findByRole("dialog", { name: "Switch branch" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Theme" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Find more themes…" }));
    expect(await screen.findByRole("dialog", { name: "Find themes" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Edit Qonsol" }));
    expect(await screen.findByRole("complementary", { name: "Edit app" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Utilities" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Check for updates" }));
    expect(await screen.findByText(/You have the latest version/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Utilities" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Help" }));
    expect(await screen.findByRole("dialog", { name: "Help" })).toBeInTheDocument();

    first.unmount();
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openApp();

    expect(screen.queryByRole("dialog", { name: "Switch branch" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Find themes" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Help" })).toBeNull();
    expect(screen.queryByRole("complementary", { name: "Edit app" })).toBeNull();
    expect(screen.queryByText(/You have the latest version/)).toBeNull();
  });

  it("R9: a newly created app opens in the calm default instead of carrying the previous app's git drawer", async () => {
    h.repo = repo({ dirty: true });
    h.api.gitChanges = vi.fn(async () => [{ path: "a.txt", status: "M", staged: false, conflict: false }]);
    render(<App />);
    await openApp();
    await expandGit();
    await userEvent.click(await screen.findByRole("button", { name: /Changes/ }));
    expect(await screen.findByRole("complementary", { name: "Git" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "+ App" }));
    const pane = await screen.findByRole("complementary", { name: "Add app" });
    await userEvent.type(within(pane).getByLabelText("App name"), "Fresh");
    await userEvent.type(within(pane).getByLabelText("Root folder"), "C:\\fresh");
    await userEvent.click(within(pane).getByRole("button", { name: "+ Add a terminal" }));
    await userEvent.click(within(pane).getByRole("button", { name: "Save" }));

    await screen.findByRole("heading", { name: "Fresh", level: 2 });
    expect(screen.queryByRole("complementary", { name: "Git" })).toBeNull();
    expect(screen.queryByRole("complementary", { name: "Consoles" })).toBeNull();
    fireEvent.focus(window); // refresh git state for the new app now rather than on the next poll
    expect(await screen.findByRole("button", { name: "Show git tools" })).toBeInTheDocument();
    // The new app opens on its first terminal, not the app it was created from.
    const visible = document.querySelectorAll('[data-testid^="host-"][data-visible="true"]');
    expect(visible).toHaveLength(1);
    expect(visible[0]).not.toBe(screen.queryByTestId("host-t1"));
  });

  it("A2: opening an app reads no saved drawer or console state and only the sidebar key is written", async () => {
    h.repo = repo({ dirty: true });
    localStorage.setItem("td.sidebarCollapsed", "0");
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openApp();
    expect(screen.queryByRole("complementary", { name: "Git" })).toBeNull();
    expect(screen.queryByRole("complementary", { name: "Consoles" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Toggle sidebar" }));
    expect(localStorage.getItem("td.sidebarCollapsed")).toBe("1");
    expect(Object.keys(localStorage).sort()).toEqual(["td.sidebarCollapsed"]);
  });
});

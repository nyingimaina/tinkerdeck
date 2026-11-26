import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigView } from "./state/model";

type Handler<T> = (v: T) => void;

const h = vi.hoisted(() => ({
  stateCb: null as null | ((p: unknown) => void),
  view: null as unknown,
  repo: null as unknown,
  api: {} as Record<string, ReturnType<typeof vi.fn>>,
  ed: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock("./api/tauri", () => {
  for (const n of [
    "saveApps", "setTheme", "setShell", "setLastRunning", "ackConfig", "startTerminal", "stopTerminal", "restartTerminal",
    "startAll", "stopAll", "writeInput", "resize", "openConfigFolder", "quitApp", "touchApp", "setFavourite", "setUpdateSettings",
    "downloadUpdate", "applyUpdate", "gitSwitch", "gitFetch", "gitPull", "gitPush", "gitSync",
  ]) h.api[n] = vi.fn(async () => undefined);
  for (const n of ["detectProject", "suggestCommands", "listSubfolders", "dockerContainers", "gitChanges", "gitLog", "gitCommitFiles"])
    h.api[n] = vi.fn(async () => []);
  h.api.getConfig = vi.fn(async () => h.view);
  h.api.terminalStates = vi.fn(async () => []);
  h.api.pathsExist = vi.fn(async (p: string[]) => p.map(() => true));
  h.api.gitInfo = vi.fn(async () => h.repo);
  h.api.gitBranches = vi.fn(async () => ({ current: "main", local: ["main"], remote: [] }));
  h.api.checkUpdate = vi.fn(async () => null);
  h.api.listShells = vi.fn(async () => [
    { id: "powershell.exe", name: "Windows PowerShell", path: "a" },
    { id: "pwsh.exe", name: "PowerShell 7", path: "b" },
  ]);
  return {
    api: h.api,
    attachTerminal: vi.fn(async () => undefined),
    onUpdateProgress: vi.fn(async () => () => {}),
    onTerminalState: vi.fn(async (cb: Handler<unknown>) => ((h.stateCb = cb), () => {})),
    onCloseRequested: vi.fn(async () => () => {}),
    pickFolder: vi.fn(async () => null),
    errorText: (e: unknown) => String(e),
  };
});

vi.mock("./api/editor", () => {
  for (const n of ["list", "open", "newDoc", "load", "snapshot", "save", "close", "restore", "discard", "takePending", "touch", "pickOpenPaths", "pickSavePath"])
    h.ed[n] = vi.fn();
  h.ed.onOpen = vi.fn(async () => () => {});
  return { editorApi: h.ed };
});

vi.mock("./features/terminals/TerminalHost", () => ({
  TerminalHost: ({ terminalId, visible }: { terminalId: string; visible: boolean }) => (
    <div data-testid={`host-${terminalId}`} data-visible={String(visible)} />
  ),
}));

vi.mock("./features/editor/CodeSurface", () => ({ default: () => <div data-testid="surface" /> }));

// The Files explorer reads one level per root; a quiet empty listing keeps these suites as they were (A3).
vi.mock("./api/explorer", () => ({
  explorerApi: {
    list: vi.fn(async (path: string) => ({ path, entries: [], total: 0, truncated: false, locked: false })),
    drives: vi.fn(async () => []),
    home: vi.fn(async () => null),
  },
}));

import { App } from "./App";

const T = (id: string, name: string) => ({ id, name, cwd: ".", command: "", env: {} });
const view = (): ConfigView => ({
  config: {
    version: 1, theme: "dark", shell: "powershell.exe", lastRunning: [],
    apps: [{ id: "a1", name: "Qonsol", root: "E:\\q", terminals: [T("t1", "api"), T("t2", "web")] }],
  },
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

async function openEditor() {
  await userEvent.click(screen.getByRole("button", { name: "Utilities" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Editor" }));
}

beforeEach(() => {
  Object.values(h.api).forEach((f) => f.mockClear());
  for (const f of Object.values(h.ed)) f.mockReset();
  h.ed.list.mockResolvedValue({ open: [], bin: [] });
  h.ed.takePending.mockResolvedValue([]);
  h.ed.onOpen.mockImplementation(async () => () => {});
  h.ed.touch.mockResolvedValue(undefined);
  h.ed.pickOpenPaths.mockResolvedValue([]);
  h.view = view();
  h.repo = null;
  h.stateCb = null;
  h.api.terminalStates.mockResolvedValue([]);
  localStorage.clear();
});

const press = (key: string, mods: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, ...mods });
  act(() => {
    window.dispatchEvent(e);
  });
  return e;
};

describe("App app-level shortcuts", () => {
  it("R4: Ctrl+Shift+P opens the command palette and Escape closes it", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });

    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Command palette" }, { timeout: 5000 });
    await waitFor(() => expect(within(dialog).getByLabelText("Search commands")).toHaveFocus());

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull());
  });

  it("R4: the palette lists each app action with the same shortcut and choosing one runs it", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });

    const dialog = await screen.findByRole("dialog", { name: "Command palette" }, { timeout: 5000 });
    expect(within(dialog).getByRole("button", { name: /Toggle sidebar/ })).toHaveTextContent("Ctrl+B");
    const refresh = within(dialog).getByRole("button", { name: /Refresh everything/ });
    expect(refresh).toHaveTextContent("No shortcut");
    expect(refresh).not.toHaveTextContent("F5");
    expect(within(dialog).getByRole("button", { name: /Switch light\/dark theme/ })).toHaveTextContent("Ctrl+Alt+T");

    await userEvent.click(within(dialog).getByRole("button", { name: /Toggle sidebar/ }));
    expect(await screen.findByRole("navigation", { name: "Apps (collapsed)" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull();
  });

  it("R4/R6: Ctrl+Alt+T switches the theme and Ctrl+B toggles the sidebar, while F5 no longer refreshes", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });

    fireEvent.keyDown(window, { key: "t", ctrlKey: true, altKey: true });
    await waitFor(() => expect(h.api.setTheme).toHaveBeenCalledWith("light"));

    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(screen.getByRole("navigation", { name: "Apps (collapsed)" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(screen.getByRole("navigation", { name: "Apps" })).toBeInTheDocument();

    const shells = h.api.listShells.mock.calls.length;
    const states = h.api.terminalStates.mock.calls.length;
    fireEvent.keyDown(window, { key: "F5" });
    await new Promise((r) => setTimeout(r, 0));
    expect(h.api.listShells.mock.calls.length).toBe(shells);
    expect(h.api.terminalStates.mock.calls.length).toBe(states);
  });

  it("R4/R7: the editor keeps Ctrl+S, Ctrl+N, Ctrl+O and Ctrl+W while it has focus", async () => {
    h.ed.takePending.mockResolvedValue(["C:/x/notes.md"]);
    h.ed.open.mockResolvedValue({ id: "n", path: "C:/x/notes.md", title: "notes.md", content: "# hello", dirty: false, eol: "lf", encoding: "utf-8" });
    h.ed.newDoc.mockResolvedValue({ id: "n2", path: null, title: "Untitled", content: "", dirty: false, eol: "lf", encoding: "utf-8" });
    h.ed.save.mockResolvedValue({ id: "n", path: "C:/x/notes.md", title: "notes.md", content: "# hello", dirty: false, eol: "lf", encoding: "utf-8" });
    h.ed.close.mockResolvedValue(undefined);

    render(<App />);
    // the pending file opens straight into the separate editor view
    expect(await screen.findByRole("button", { name: "Open…" })).toBeInTheDocument();
    expect(await screen.findByTestId("surface")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect(h.ed.save).toHaveBeenCalledWith("n", "# hello", null);

    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    expect(h.ed.newDoc).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "o", ctrlKey: true });
    expect(h.ed.pickOpenPaths).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull();

    fireEvent.keyDown(window, { key: "w", ctrlKey: true });
    expect(h.ed.close).toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    expect(await screen.findByRole("dialog", { name: "Command palette" }, { timeout: 5000 })).toBeInTheDocument();
  });

  it("R5/R8: an app view starts with the git tools collapsed behind the branch chip and they hide again on demand", async () => {
    h.repo = repo({ dirty: true });
    render(<App />);
    await openApp();

    const pill = await screen.findByRole("button", { name: /Switch branch, current main/ });
    expect(pill).toHaveTextContent("main");
    expect(screen.getByLabelText("Ahead and behind")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show git tools" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /Fetch/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Changes/ })).toBeNull();
    expect(screen.queryByRole("complementary", { name: "Git" })).toBeNull();
    expect(screen.queryByRole("complementary", { name: "Consoles" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Show git tools" }));
    expect(screen.getByRole("button", { name: /Fetch/ })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: /Changes/ }));
    expect(await screen.findByRole("complementary", { name: "Git" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close git panel" }));
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Git" })).toBeNull());

    await userEvent.click(screen.getByRole("button", { name: "Hide git tools" }));
    expect(screen.getByRole("button", { name: "Show git tools" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /Fetch/ })).toBeNull();
  });

  it("R2: the footer stays visible and the editor stays its own full view while optional parts are hidden", async () => {
    h.repo = repo();
    render(<App />);
    await openApp("Qonsol");

    expect(screen.getByRole("contentinfo", { name: "Status" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open…" })).toBeNull(); // no editor embedded in the app view
    expect(screen.getByRole("button", { name: "Show git tools" })).toBeInTheDocument(); // git tools hidden by default

    await openEditor();
    expect(await screen.findByRole("button", { name: "Open…" })).toBeInTheDocument();
    expect(screen.getByRole("contentinfo", { name: "Status" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Qonsol", level: 2 })).toBeNull();
  });

  it("R7: the palette lists every app-level command with its real shortcut or no shortcut, and app-only ones only while an app is open", async () => {
    h.repo = repo();
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });

    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    let dialog = await screen.findByRole("dialog", { name: "Command palette" }, { timeout: 5000 });
    for (const name of [
      /Toggle sidebar/,
      /Refresh everything/,
      /Switch light\/dark theme/,
      /Open command palette/,
      /Open editor/,
      /Check for updates/,
      /Help/,
      /Go to Home/,
      /Find themes/,
      /Reset layout/,
    ]) {
      expect(within(dialog).getByRole("button", { name })).toBeInTheDocument();
    }
    expect(within(dialog).getByRole("button", { name: /Toggle sidebar/ })).toHaveTextContent("Ctrl+B");
    expect(within(dialog).getByRole("button", { name: /Open command palette/ })).toHaveTextContent("Ctrl+Shift+P");
    expect(within(dialog).getByRole("button", { name: /Reset layout/ })).not.toHaveTextContent("Ctrl+");
    // A command that only exists while an app is open is not offered before one is open.
    expect(within(dialog).queryByRole("button", { name: /Edit app/ })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /Start all/ })).toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull());

    await openApp();
    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    dialog = await screen.findByRole("dialog", { name: "Command palette" }, { timeout: 5000 });
    for (const name of [/Edit app/, /Start all/, /Stop all/, /Open console/, /New console/]) {
      expect(within(dialog).getByRole("button", { name })).toBeInTheDocument();
    }
    // Git has two entry points in the bar, but one palette command each, never a duplicate.
    await waitFor(() => expect(within(dialog).getAllByRole("button", { name: /Git: show changes/ })).toHaveLength(1));
    expect(within(dialog).getAllByRole("button", { name: /Git: show history/ })).toHaveLength(1);
  });

  it("R7: a query that matches no command shows an empty result", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Command palette" }, { timeout: 5000 });
    await userEvent.type(within(dialog).getByLabelText("Search commands"), "zzzzzz");
    expect(within(dialog).getByText("No commands match.")).toBeInTheDocument();
  });

  it("R7: typing a hidden command's name finds it and runs it", async () => {
    h.repo = repo({ dirty: true });
    h.api.gitChanges = vi.fn(async () => [{ path: "a.txt", status: "M", staged: false, conflict: false }]);
    render(<App />);
    await openApp();
    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Command palette" }, { timeout: 5000 });
    await userEvent.type(within(dialog).getByLabelText("Search commands"), "changes");
    await userEvent.click(within(dialog).getByRole("button", { name: /Git: show changes/ }));
    expect(await screen.findByRole("complementary", { name: "Git" })).toBeInTheDocument();
  });

  it("R8: the palette hides a running console without stopping it, and showing it again keeps it running", async () => {
    render(<App />);
    await openApp();
    await userEvent.click(screen.getByRole("tab", { name: /Console/ }));
    await waitFor(() => expect(h.api.startTerminal).toHaveBeenCalledWith("a1", "console-a1:1"));

    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Command palette" }, { timeout: 5000 });
    await userEvent.click(within(dialog).getByRole("button", { name: /Hide console/ }));
    expect(screen.getByTestId("host-console-a1:1")).toHaveAttribute("data-visible", "false");
    expect(h.api.stopTerminal).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("tab", { name: /Console/ }));
    expect(screen.getByTestId("host-console-a1:1")).toHaveAttribute("data-visible", "true");
    expect(h.api.startTerminal).toHaveBeenCalledTimes(1);
  });

  it("R7/R8: the palette hides and reopens the git tools, the git drawer and the console", async () => {
    h.repo = repo({ dirty: true });
    h.api.gitChanges = vi.fn(async () => [{ path: "a.txt", status: "M", staged: false, conflict: false }]);
    render(<App />);
    await openApp();

    // Git tools: shown from the palette, then hidden again from the palette.
    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    let dialog = await screen.findByRole("dialog", { name: "Command palette" }, { timeout: 5000 });
    await userEvent.click(within(dialog).getByRole("button", { name: /Show git tools/ }));
    expect(screen.getByRole("button", { name: "Hide git tools" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /Fetch/ })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    dialog = await screen.findByRole("dialog", { name: "Command palette" }, { timeout: 5000 });
    await userEvent.click(within(dialog).getByRole("button", { name: /Hide git tools/ }));
    expect(screen.getByRole("button", { name: "Show git tools" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /Fetch/ })).toBeNull();

    // Git drawer: opened, closed and reopened from the palette.
    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    dialog = await screen.findByRole("dialog", { name: "Command palette" }, { timeout: 5000 });
    await userEvent.click(within(dialog).getByRole("button", { name: /Git: show changes/ }));
    expect(await screen.findByRole("complementary", { name: "Git" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    dialog = await screen.findByRole("dialog", { name: "Command palette" }, { timeout: 5000 });
    await userEvent.click(within(dialog).getByRole("button", { name: /Close git drawer/ }));
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Git" })).toBeNull());

    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    dialog = await screen.findByRole("dialog", { name: "Command palette" }, { timeout: 5000 });
    await userEvent.click(within(dialog).getByRole("button", { name: /Git: show changes/ }));
    expect(await screen.findByRole("complementary", { name: "Git" })).toBeInTheDocument();

    // Console: hidden and reopened from the palette, the running shell is never stopped.
    await userEvent.click(screen.getByRole("tab", { name: /Console/ }));
    await waitFor(() => expect(h.api.startTerminal).toHaveBeenCalledWith("a1", "console-a1:1"));
    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    dialog = await screen.findByRole("dialog", { name: "Command palette" }, { timeout: 5000 });
    await userEvent.click(within(dialog).getByRole("button", { name: /Hide console/ }));
    expect(screen.getByTestId("host-console-a1:1")).toHaveAttribute("data-visible", "false");
    expect(h.api.stopTerminal).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    dialog = await screen.findByRole("dialog", { name: "Command palette" }, { timeout: 5000 });
    await userEvent.click(within(dialog).getByRole("button", { name: /Open console/ }));
    expect(await screen.findByRole("complementary", { name: "Consoles" })).toBeInTheDocument();
    expect(screen.getByTestId("host-console-a1:1")).toHaveAttribute("data-visible", "true");
    expect(h.api.startTerminal).toHaveBeenCalledTimes(1);
  });

  it("R7: closing the palette with Escape returns focus to the control that had it, never the page body", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });

    // Opened from the body (Ctrl+Shift+P with nothing focused), Escape lands on a named,
    // always-visible control instead of leaving focus on <body>.
    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    let dialog = await screen.findByRole("dialog", { name: "Command palette" }, { timeout: 5000 });
    await waitFor(() => expect(within(dialog).getByLabelText("Search commands")).toHaveFocus());
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull());
    await waitFor(() => expect(screen.getByRole("button", { name: "Toggle sidebar" })).toHaveFocus());

    // Opened while a specific control had focus, Escape hands it back.
    const opener = screen.getByRole("button", { name: "Hide sidebar" });
    opener.focus();
    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    dialog = await screen.findByRole("dialog", { name: "Command palette" }, { timeout: 5000 });
    await waitFor(() => expect(within(dialog).getByLabelText("Search commands")).toHaveFocus());
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("R6: in the app view with everything stopped, F5 starts all exactly as the button would", async () => {
    render(<App />);
    await openApp();
    expect(screen.getByRole("button", { name: /Start all/ })).toBeInTheDocument();
    const states = h.api.terminalStates.mock.calls.length;

    const e = press("F5");
    expect(e.defaultPrevented).toBe(true);
    await waitFor(() => expect(h.api.startAll).toHaveBeenCalledWith("a1"));
    expect(h.api.stopAll).not.toHaveBeenCalled();
    // F5 is not a refresh any more.
    expect(h.api.terminalStates.mock.calls.length).toBe(states);
  });

  it("R6: in the app view with a running terminal, F5 stops them exactly as the button would", async () => {
    h.api.terminalStates.mockResolvedValue([{ terminalId: "t1", state: { kind: "running" } }]);
    render(<App />);
    await openApp();
    expect(screen.getByRole("button", { name: /Stop all/ })).toBeInTheDocument();

    press("F5");
    await waitFor(() => expect(h.api.stopAll).toHaveBeenCalledWith("a1"));
    expect(h.api.startAll).not.toHaveBeenCalled();
  });

  it("R6: F5 while a terminal is still starting stops it rather than starting a second copy", async () => {
    h.api.terminalStates.mockResolvedValue([{ terminalId: "t1", state: { kind: "starting" } }]);
    render(<App />);
    await openApp();

    press("F5");
    await waitFor(() => expect(h.api.stopAll).toHaveBeenCalledWith("a1"));
    expect(h.api.startAll).not.toHaveBeenCalled();
  });

  it("R6: pressing F5 twice in quick succession starts once and then stops, never starting a terminal twice", async () => {
    // The core reports the start back at once; the second press must read that live state and
    // stop, rather than ask for a second start and leave the app half-started (R6).
    h.api.startAll.mockImplementationOnce(async () => {
      h.stateCb?.({ terminalId: "t1", appId: "a1", state: { kind: "starting" } });
      h.stateCb?.({ terminalId: "t2", appId: "a1", state: { kind: "stopped" } });
    });
    h.api.stopAll.mockImplementationOnce(async () => {
      h.stateCb?.({ terminalId: "t1", appId: "a1", state: { kind: "stopped" } });
    });
    render(<App />);
    await openApp();
    await waitFor(() => expect(h.stateCb).not.toBeNull());
    expect(screen.getByRole("button", { name: /Start all/ })).toBeInTheDocument();

    press("F5");
    press("F5");
    await waitFor(() => expect(h.api.stopAll).toHaveBeenCalledWith("a1"));

    expect(h.api.startAll).toHaveBeenCalledTimes(1);
    expect(h.api.stopAll).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole("button", { name: /Start all/ })).toBeInTheDocument());
  });

  it("R6: pressing F5 repeatedly while a start is in progress never starts a second copy", async () => {
    h.api.terminalStates.mockResolvedValue([{ terminalId: "t1", state: { kind: "starting" } }]);
    render(<App />);
    await openApp();
    await waitFor(() => expect(h.stateCb).not.toBeNull());
    expect(screen.getByRole("button", { name: /Stop all/ })).toBeInTheDocument();

    press("F5");
    press("F5");
    await waitFor(() => expect(h.api.stopAll).toHaveBeenCalledTimes(2));

    // Both presses saw the in-progress start and asked to stop; neither asked to start again.
    expect(h.api.startAll).not.toHaveBeenCalled();
    act(() => h.stateCb?.({ terminalId: "t1", appId: "a1", state: { kind: "stopped" } }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Start all/ })).toBeInTheDocument());
  });

  it("R6: F5 in the home view is a true no-op and cannot reload the page", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    const states = h.api.terminalStates.mock.calls.length;
    const shells = h.api.listShells.mock.calls.length;

    const e = press("F5");
    await new Promise((r) => setTimeout(r, 0));

    expect(e.defaultPrevented).toBe(true);
    expect(h.api.startAll).not.toHaveBeenCalled();
    expect(h.api.stopAll).not.toHaveBeenCalled();
    expect(h.api.terminalStates.mock.calls.length).toBe(states);
    expect(h.api.listShells.mock.calls.length).toBe(shells);
    expect(screen.getByRole("heading", { name: "Home", level: 2 })).toBeInTheDocument();
  });

  it("R6: F5 in the editor view is a true no-op and leaves the view alone", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openEditor();
    // The editor's own New toolbar control identifies the view; the explorer toolbar adds a
    // second "New file", so that name is no longer unique (R9).
    expect(await screen.findByRole("button", { name: "New" })).toBeInTheDocument();
    const states = h.api.terminalStates.mock.calls.length;

    const e = press("F5");
    await new Promise((r) => setTimeout(r, 0));

    expect(e.defaultPrevented).toBe(true);
    expect(h.api.startAll).not.toHaveBeenCalled();
    expect(h.api.stopAll).not.toHaveBeenCalled();
    expect(h.api.terminalStates.mock.calls.length).toBe(states);
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
  });

  it("R6: F5 with Shift, Ctrl or Alt never refreshes in the home view", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    const states = h.api.terminalStates.mock.calls.length;
    const shells = h.api.listShells.mock.calls.length;

    for (const mods of [{ shiftKey: true }, { ctrlKey: true }, { altKey: true }, { ctrlKey: true, shiftKey: true }]) {
      const e = press("F5", mods);
      expect(e.defaultPrevented).toBe(true);
    }
    await new Promise((r) => setTimeout(r, 0));

    expect(h.api.terminalStates.mock.calls.length).toBe(states);
    expect(h.api.listShells.mock.calls.length).toBe(shells);
    expect(h.api.startAll).not.toHaveBeenCalled();
    expect(h.api.stopAll).not.toHaveBeenCalled();
  });

  it("R6: F5 does nothing for an app with no terminals, matching its disabled Start all button", async () => {
    const base = view();
    h.view = {
      ...base,
      config: { ...base.config, apps: [{ ...base.config.apps[0], terminals: [] }] },
    };
    render(<App />);
    await openApp();
    expect(screen.getByRole("button", { name: /Start all/ })).toBeDisabled();

    press("F5");
    await new Promise((r) => setTimeout(r, 0));
    expect(h.api.startAll).not.toHaveBeenCalled();
    expect(h.api.stopAll).not.toHaveBeenCalled();
  });

  it("R9: opening an app restores only the sidebar state and starts with the git drawer and console hidden", async () => {
    localStorage.setItem("td.sidebarCollapsed", "1");
    h.repo = repo();
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    expect(screen.getByRole("navigation", { name: "Apps (collapsed)" })).toBeInTheDocument();

    await openApp();
    expect(screen.getByRole("button", { name: "Show git tools" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("complementary", { name: "Git" })).toBeNull();
    expect(screen.queryByRole("complementary", { name: "Consoles" })).toBeNull();
  });
});

const execView = (t1: boolean, t2: boolean): ConfigView => {
  const base = view();
  return {
    ...base,
    config: {
      ...base.config,
      apps: [
        {
          ...base.config.apps[0],
          terminals: [
            { ...T("t1", "api"), executable: t1 },
            { ...T("t2", "web"), executable: t2 },
          ],
        },
      ],
    },
  };
};

describe("the executable flag and F5 (R11)", () => {
  it("R11: the Start all button and F5 count only executable terminals", async () => {
    h.view = execView(true, false);
    // The non-executable terminal is running by hand; it must not turn the bulk action into Stop.
    h.api.terminalStates.mockResolvedValue([{ terminalId: "t2", state: { kind: "running" } }]);
    render(<App />);
    await openApp();

    expect(screen.getByRole("button", { name: /Start all/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Stop all/ })).toBeNull();

    press("F5");
    await waitFor(() => expect(h.api.startAll).toHaveBeenCalledWith("a1"));
    expect(h.api.stopAll).not.toHaveBeenCalled();
  });

  it("R11: a non-executable terminal is still left out when the executable one is running", async () => {
    h.view = execView(true, false);
    h.api.terminalStates.mockResolvedValue([
      { terminalId: "t1", state: { kind: "running" } },
      { terminalId: "t2", state: { kind: "running" } },
    ]);
    render(<App />);
    await openApp();

    expect(screen.getByRole("button", { name: /Stop all/ })).toBeInTheDocument();
    press("F5");
    await waitFor(() => expect(h.api.stopAll).toHaveBeenCalledWith("a1"));
    expect(h.api.startAll).not.toHaveBeenCalled();
  });

  it("R11: when every terminal is non-executable, F5 starts nothing and says so briefly", async () => {
    h.view = execView(false, false);
    render(<App />);
    await openApp();
    expect(screen.getByRole("button", { name: /Start all/ })).toBeInTheDocument();

    press("F5");

    expect(await screen.findByText("No executable terminals")).toBeInTheDocument();
    expect(h.api.startAll).not.toHaveBeenCalled();
    expect(h.api.stopAll).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("No executable terminals")).toBeNull();
    // Dismissing leaves the view and the app exactly as they were.
    expect(screen.getByRole("heading", { name: "Qonsol", level: 2 })).toBeInTheDocument();
  });

  it("R11: the Start all button says the same thing as F5 when nothing is executable", async () => {
    h.view = execView(false, false);
    render(<App />);
    await openApp();

    await userEvent.click(screen.getByRole("button", { name: /Start all/ }));

    expect(await screen.findByText("No executable terminals")).toBeInTheDocument();
    expect(h.api.startAll).not.toHaveBeenCalled();
  });
});

describe("the palette shows the real F5 hint (R12)", () => {
  it("R12: Start all and Stop all show F5 while Refresh everything shows No shortcut", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openApp();

    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Command palette" }, { timeout: 5000 });

    expect(within(dialog).getByRole("button", { name: /Start all/ })).toHaveTextContent("F5");
    expect(within(dialog).getByRole("button", { name: /Stop all/ })).toHaveTextContent("F5");
    const refresh = within(dialog).getByRole("button", { name: /Refresh everything/ });
    expect(refresh).toHaveTextContent("No shortcut");
    expect(refresh).not.toHaveTextContent("F5");
  });
});

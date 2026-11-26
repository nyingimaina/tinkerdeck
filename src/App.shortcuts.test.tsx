import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  localStorage.clear();
});

describe("App app-level shortcuts", () => {
  it("R4: Ctrl+Shift+P opens the command palette and Escape closes it", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });

    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    await waitFor(() => expect(within(dialog).getByLabelText("Search commands")).toHaveFocus());

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull());
  });

  it("R4: the palette lists each app action with the same shortcut and choosing one runs it", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });

    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    expect(within(dialog).getByRole("button", { name: /Toggle sidebar/ })).toHaveTextContent("Ctrl+B");
    expect(within(dialog).getByRole("button", { name: /Refresh everything/ })).toHaveTextContent("F5");
    expect(within(dialog).getByRole("button", { name: /Switch light\/dark theme/ })).toHaveTextContent("Ctrl+Alt+T");

    await userEvent.click(within(dialog).getByRole("button", { name: /Toggle sidebar/ }));
    expect(await screen.findByRole("navigation", { name: "Apps (collapsed)" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull();
  });

  it("R4: Ctrl+Alt+T switches the theme while Ctrl+B and F5 keep their old actions", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });

    fireEvent.keyDown(window, { key: "t", ctrlKey: true, altKey: true });
    await waitFor(() => expect(h.api.setTheme).toHaveBeenCalledWith("light"));

    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(screen.getByRole("navigation", { name: "Apps (collapsed)" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(screen.getByRole("navigation", { name: "Apps" })).toBeInTheDocument();

    const shells = h.api.listShells.mock.calls.length;
    fireEvent.keyDown(window, { key: "F5" });
    await waitFor(() => expect(h.api.listShells.mock.calls.length).toBeGreaterThan(shells));
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
    expect(await screen.findByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
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
    let dialog = await screen.findByRole("dialog", { name: "Command palette" });
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
    dialog = await screen.findByRole("dialog", { name: "Command palette" });
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
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    await userEvent.type(within(dialog).getByLabelText("Search commands"), "zzzzzz");
    expect(within(dialog).getByText("No commands match.")).toBeInTheDocument();
  });

  it("R7: typing a hidden command's name finds it and runs it", async () => {
    h.repo = repo({ dirty: true });
    h.api.gitChanges = vi.fn(async () => [{ path: "a.txt", status: "M", staged: false, conflict: false }]);
    render(<App />);
    await openApp();
    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
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
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
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
    let dialog = await screen.findByRole("dialog", { name: "Command palette" });
    await userEvent.click(within(dialog).getByRole("button", { name: /Show git tools/ }));
    expect(screen.getByRole("button", { name: "Hide git tools" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /Fetch/ })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    dialog = await screen.findByRole("dialog", { name: "Command palette" });
    await userEvent.click(within(dialog).getByRole("button", { name: /Hide git tools/ }));
    expect(screen.getByRole("button", { name: "Show git tools" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /Fetch/ })).toBeNull();

    // Git drawer: opened, closed and reopened from the palette.
    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    dialog = await screen.findByRole("dialog", { name: "Command palette" });
    await userEvent.click(within(dialog).getByRole("button", { name: /Git: show changes/ }));
    expect(await screen.findByRole("complementary", { name: "Git" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    dialog = await screen.findByRole("dialog", { name: "Command palette" });
    await userEvent.click(within(dialog).getByRole("button", { name: /Close git drawer/ }));
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Git" })).toBeNull());

    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    dialog = await screen.findByRole("dialog", { name: "Command palette" });
    await userEvent.click(within(dialog).getByRole("button", { name: /Git: show changes/ }));
    expect(await screen.findByRole("complementary", { name: "Git" })).toBeInTheDocument();

    // Console: hidden and reopened from the palette, the running shell is never stopped.
    await userEvent.click(screen.getByRole("tab", { name: /Console/ }));
    await waitFor(() => expect(h.api.startTerminal).toHaveBeenCalledWith("a1", "console-a1:1"));
    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    dialog = await screen.findByRole("dialog", { name: "Command palette" });
    await userEvent.click(within(dialog).getByRole("button", { name: /Hide console/ }));
    expect(screen.getByTestId("host-console-a1:1")).toHaveAttribute("data-visible", "false");
    expect(h.api.stopTerminal).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    dialog = await screen.findByRole("dialog", { name: "Command palette" });
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
    let dialog = await screen.findByRole("dialog", { name: "Command palette" });
    await waitFor(() => expect(within(dialog).getByLabelText("Search commands")).toHaveFocus());
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull());
    await waitFor(() => expect(screen.getByRole("button", { name: "Toggle sidebar" })).toHaveFocus());

    // Opened while a specific control had focus, Escape hands it back.
    const opener = screen.getByRole("button", { name: "Hide sidebar" });
    opener.focus();
    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    dialog = await screen.findByRole("dialog", { name: "Command palette" });
    await waitFor(() => expect(within(dialog).getByLabelText("Search commands")).toHaveFocus());
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
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

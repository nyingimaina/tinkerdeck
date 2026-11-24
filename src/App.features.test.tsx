import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigView } from "./state/model";

const h = vi.hoisted(() => ({
  stateCb: null as null | ((p: unknown) => void),
  view: null as unknown,
  states: [] as unknown[],
  repo: null as unknown,
  picked: null as string | null,
  api: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock("./api/tauri", () => {
  const names = [
    "saveApps", "setTheme", "setShell", "setLastRunning", "ackConfig", "startTerminal", "stopTerminal", "restartTerminal",
    "startAll", "stopAll", "writeInput", "resize", "openConfigFolder", "quitApp", "touchApp", "setFavourite",
    "gitSwitch", "gitFetch", "gitPull", "gitPush", "gitSync",
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
    { id: "gitbash", name: "Git Bash", path: "c" },
  ]);
  h.api.gitBranches = vi.fn(async () => ({ current: "main", local: ["main", "feature"], remote: [] }));
  return {
    api: h.api,
    attachTerminal: vi.fn(async () => undefined),
    onTerminalState: vi.fn(async (cb: (p: unknown) => void) => ((h.stateCb = cb), () => {})),
    onCloseRequested: vi.fn(async () => () => {}),
    pickFolder: vi.fn(async () => h.picked),
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

beforeEach(() => {
  Object.values(h.api).forEach((f) => f.mockClear());
  h.view = view();
  h.states = [];
  h.repo = null;
  h.picked = null;
});

describe("Home", () => {
  it("launches on Home and opens an app from its card, recording it as recent", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Home", level: 2 })).toBeInTheDocument();
    await openApp();
    expect(h.api.touchApp).toHaveBeenCalledWith("a1");
    await userEvent.click(screen.getByRole("button", { name: /Home/ }));
    expect(await screen.findByRole("heading", { name: "Home", level: 2 })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Recent" })).getByText("Qonsol")).toBeInTheDocument();
  });

  it("T28: starring an app saves it as a favourite and shows it under Favourites", async () => {
    render(<App />);
    await userEvent.click((await screen.findAllByRole("button", { name: "Add Qonsol to favourites" }))[0]);
    expect(h.api.setFavourite).toHaveBeenCalledWith("a1", true);
    expect(await screen.findByRole("region", { name: "Favourites" })).toBeInTheDocument();
  });

  it("Start all on a card starts the app and counts as opening it", async () => {
    render(<App />);
    await userEvent.click((await screen.findAllByRole("button", { name: "Start all in Qonsol" }))[0]);
    expect(h.api.startAll).toHaveBeenCalledWith("a1");
    expect(h.api.touchApp).toHaveBeenCalledWith("a1");
  });

  it("T29: a missing project folder is greyed out on Home", async () => {
    h.api.pathsExist = vi.fn(async (p: string[]) => p.map(() => false));
    render(<App />);
    expect((await screen.findAllByText("Folder not found")).length).toBeGreaterThan(0);
    h.api.pathsExist = vi.fn(async (p: string[]) => p.map(() => true));
  });

  it("Open folder… detects the project, saves the app and opens it in one step", async () => {
    h.picked = "E:\\code\\Shop";
    h.api.detectProject = vi.fn(async () => [
      { name: "frontend", cwd: "frontend", command: "npm run dev", stopCommand: null, kind: "node", primary: true },
      { name: "frontend", cwd: "admin", command: "npm run dev", stopCommand: null, kind: "node", primary: true },
    ]);
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /Open folder/ }));
    await waitFor(() => expect(h.api.saveApps).toHaveBeenCalled());
    const saved = h.api.saveApps.mock.calls[0][0] as { name: string; root: string; terminals: { name: string }[] }[];
    const created = saved[saved.length - 1];
    expect(created).toMatchObject({ name: "Shop", root: "E:\\code\\Shop" });
    expect(created.terminals.map((t) => t.name)).toEqual(["frontend", "frontend 2"]);
    expect(await screen.findByRole("heading", { name: "Shop", level: 2 })).toBeInTheDocument();
  });

  it("Open folder… does nothing when the picker is cancelled", async () => {
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /Open folder/ }));
    expect(h.api.saveApps).not.toHaveBeenCalled();
  });
});

describe("Git in the app", () => {
  it("shows the branch pill for a repository and nothing for a plain folder", async () => {
    h.repo = repo({ dirty: true });
    render(<App />);
    await openApp();
    expect(await screen.findByRole("button", { name: /Switch branch, current main/ })).toHaveTextContent("main ●");
  });

  it("hides git entirely outside a repository", async () => {
    render(<App />);
    await openApp();
    await waitFor(() => expect(h.api.gitInfo).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /Switch branch/ })).toBeNull();
  });

  it("T30/T31: switching branch with nothing running switches immediately", async () => {
    h.repo = repo();
    render(<App />);
    await openApp();
    await userEvent.click(await screen.findByRole("button", { name: /Switch branch/ }));
    await userEvent.click(await screen.findByRole("button", { name: "feature" }));
    await waitFor(() => expect(h.api.gitSwitch).toHaveBeenCalledWith("a1", "feature"));
    expect(screen.queryByRole("dialog", { name: /Switch to/ })).toBeNull();
  });

  it("T31: with terminals running it warns and offers stop, switch, start", async () => {
    h.repo = repo();
    h.states = [{ terminalId: "t1", appId: "a1", state: { kind: "running" } }];
    h.api.stopTerminal.mockImplementation(async () => {
      h.stateCb?.({ terminalId: "t1", appId: "a1", state: { kind: "stopped" } });
    });
    render(<App />);
    await openApp();
    await userEvent.click(await screen.findByRole("button", { name: /Switch branch/ }));
    await userEvent.click(await screen.findByRole("button", { name: "feature" }));
    const dlg = await screen.findByRole("dialog", { name: "Switch to feature?" });
    expect(dlg).toHaveTextContent("1 terminal is running");
    expect(h.api.gitSwitch).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Stop all, switch, Start all" }));
    await waitFor(() => expect(h.api.stopTerminal).toHaveBeenCalledWith("a1", "t1"));
    await waitFor(() => expect(h.api.gitSwitch).toHaveBeenCalledWith("a1", "feature"));
    await waitFor(() => expect(h.api.startTerminal).toHaveBeenCalledWith("a1", "t1")); // only the one that ran
    expect(h.api.startTerminal).toHaveBeenCalledTimes(1);
  });

  it("the warning offers Switch anyway and Cancel", async () => {
    h.repo = repo();
    h.states = [{ terminalId: "t2", appId: "a1", state: { kind: "running" } }];
    render(<App />);
    await openApp();
    await userEvent.click(await screen.findByRole("button", { name: /Switch branch/ }));
    await userEvent.click(await screen.findByRole("button", { name: "feature" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(h.api.gitSwitch).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /Switch branch/ }));
    await userEvent.click(await screen.findByRole("button", { name: "feature" }));
    await userEvent.click(await screen.findByRole("button", { name: "Switch anyway" }));
    await waitFor(() => expect(h.api.gitSwitch).toHaveBeenCalledWith("a1", "feature"));
    expect(h.api.stopTerminal).not.toHaveBeenCalled();
  });

  it("T33: Sync, Push and Pull call Rust and show the result message", async () => {
    h.repo = repo({ ahead: 1 });
    h.api.gitSync.mockResolvedValue("Synced: pulled and pushed.");
    render(<App />);
    await openApp();
    await userEvent.click(await screen.findByRole("button", { name: /Sync/ }));
    expect(h.api.gitSync).toHaveBeenCalledWith("a1");
    expect(await screen.findByText("Synced: pulled and pushed.")).toBeInTheDocument();
  });

  it("T34: a failed pull shows git's explanation as an error", async () => {
    h.repo = repo({ behind: 1, ahead: 1 });
    h.api.gitPull.mockRejectedValue("Your branch and the remote have both changed, so a fast-forward is not possible.");
    render(<App />);
    await openApp();
    await userEvent.click(await screen.findByRole("button", { name: /Pull/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("fast-forward is not possible");
  });

  it("opens the Changes drawer from the bar", async () => {
    h.repo = repo({ dirty: true });
    h.api.gitChanges = vi.fn(async () => [{ path: "a.txt", status: "M", staged: false, conflict: false }]);
    render(<App />);
    await openApp();
    await userEvent.click(await screen.findByRole("button", { name: /Changes/ }));
    expect(await screen.findByLabelText("a.txt")).toBeInTheDocument();
  });
});

describe("Consoles", () => {
  const tab = () => screen.getByRole("tab", { name: /Console/ });
  const emit = (p: unknown) =>
    act(async () => {
      h.stateCb?.(p);
    });

  it("T35: the Console tab starts its first console on first open and is not part of Start all", async () => {
    render(<App />);
    await openApp();
    expect(h.api.startTerminal).not.toHaveBeenCalled();
    await userEvent.click(tab());
    await waitFor(() => expect(h.api.startTerminal).toHaveBeenCalledWith("a1", "console-a1:1"));
    expect(screen.getByTestId("host-console-a1:1").dataset.visible).toBe("true");
    expect(screen.getByTestId("host-t1").dataset.visible).toBe("false"); // saved terminals stay alive, hidden
    expect(screen.getByRole("complementary", { name: "Consoles" })).toBeInTheDocument();
    // a second visit does not start it again
    await userEvent.click(screen.getByRole("tab", { name: /api/ }));
    expect(screen.queryByRole("complementary", { name: "Consoles" })).toBeNull();
    await userEvent.click(tab());
    expect(h.api.startTerminal).toHaveBeenCalledTimes(1);
  });

  it("any number of consoles: + adds one with the default shell, the arrow picks another shell", async () => {
    render(<App />);
    await openApp();
    await userEvent.click(tab());
    await userEvent.click(screen.getByRole("button", { name: "New console" }));
    await waitFor(() => expect(h.api.startTerminal).toHaveBeenCalledWith("a1", "console-a1:2"));
    await userEvent.click(screen.getByRole("button", { name: "Choose shell for a new console" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Git Bash" }));
    await waitFor(() => expect(h.api.startTerminal).toHaveBeenCalledWith("a1", "console-a1:3:gitbash"));
    const nav = screen.getByRole("complementary", { name: "Consoles" });
    expect(within(nav).getAllByRole("button", { name: /^Console \d/ })).toHaveLength(3);
    expect(screen.getByTestId("host-console-a1:3:gitbash").dataset.visible).toBe("true");
    // switching in the list shows that console
    await userEvent.click(within(nav).getByRole("button", { name: "Console 1, default shell" }));
    expect(screen.getByTestId("host-console-a1:1").dataset.visible).toBe("true");
    expect(screen.getByTestId("host-console-a1:3:gitbash").dataset.visible).toBe("false");
  });

  it("closing an idle extra console just removes it; the first console cannot be closed", async () => {
    render(<App />);
    await openApp();
    await userEvent.click(tab());
    await userEvent.click(screen.getByRole("button", { name: "New console" }));
    expect(screen.getByRole("button", { name: "Close Console 1" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Close Console 2" }));
    await waitFor(() => expect(screen.queryByTestId("host-console-a1:2")).toBeNull());
    expect(screen.getByTestId("host-console-a1:1").dataset.visible).toBe("true");
  });

  it("closing a console with something running asks first, stops it, then removes it", async () => {
    render(<App />);
    await openApp();
    await userEvent.click(tab());
    await userEvent.click(screen.getByRole("button", { name: "New console" }));
    await emit({ terminalId: "console-a1:2", appId: "a1", state: { kind: "running" } });
    h.api.stopTerminal.mockImplementation(async () => {
      h.stateCb?.({ terminalId: "console-a1:2", appId: "a1", state: { kind: "stopped" } });
    });
    await userEvent.click(screen.getByRole("button", { name: "Close Console 2" }));
    expect(await screen.findByRole("dialog", { name: "Close Console 2?" })).toBeInTheDocument();
    expect(h.api.stopTerminal).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Stop and close" }));
    await waitFor(() => expect(h.api.stopTerminal).toHaveBeenCalledWith("a1", "console-a1:2"));
    await waitFor(() => expect(screen.queryByTestId("host-console-a1:2")).toBeNull());
  });

  it("GUARD: typing exit in the first console starts a fresh shell and says so", async () => {
    render(<App />);
    await openApp();
    await userEvent.click(tab());
    await waitFor(() => expect(h.api.startTerminal).toHaveBeenCalledTimes(1));
    await emit({ terminalId: "console-a1:1", appId: "a1", state: { kind: "running" } });
    await emit({ terminalId: "console-a1:1", appId: "a1", state: { kind: "exited", code: 0 } }); // the user typed exit
    await waitFor(() => expect(h.api.startTerminal).toHaveBeenCalledTimes(2));
    expect(h.api.startTerminal).toHaveBeenLastCalledWith("a1", "console-a1:1");
    expect(await screen.findByRole("status")).toHaveTextContent(/fresh one was started/);
  });

  it("GUARD: no restart loop: a shell that dies again right after a restart is left alone", async () => {
    render(<App />);
    await openApp();
    await userEvent.click(tab());
    await waitFor(() => expect(h.api.startTerminal).toHaveBeenCalledTimes(1));
    const bounce = async () => {
      await emit({ terminalId: "console-a1:1", appId: "a1", state: { kind: "running" } });
      await emit({ terminalId: "console-a1:1", appId: "a1", state: { kind: "exited", code: 1 } });
    };
    await bounce();
    await waitFor(() => expect(h.api.startTerminal).toHaveBeenCalledTimes(2));
    await bounce(); // dies again immediately
    await new Promise((r) => setTimeout(r, 600));
    expect(h.api.startTerminal).toHaveBeenCalledTimes(2);
  });

  it("GUARD: an extra console that exits closes itself; a user Stop does not trigger anything", async () => {
    render(<App />);
    await openApp();
    await userEvent.click(tab());
    await userEvent.click(screen.getByRole("button", { name: "New console" }));
    await emit({ terminalId: "console-a1:2", appId: "a1", state: { kind: "running" } });
    await emit({ terminalId: "console-a1:2", appId: "a1", state: { kind: "exited", code: 0 } });
    await waitFor(() => expect(screen.queryByTestId("host-console-a1:2")).toBeNull());
    // user Stop on the first console: nothing restarts
    await emit({ terminalId: "console-a1:1", appId: "a1", state: { kind: "running" } });
    await emit({ terminalId: "console-a1:1", appId: "a1", state: { kind: "stopping" } });
    await emit({ terminalId: "console-a1:1", appId: "a1", state: { kind: "stopped" } });
    const calls = h.api.startTerminal.mock.calls.length;
    await new Promise((r) => setTimeout(r, 500));
    expect(h.api.startTerminal.mock.calls.length).toBe(calls);
  });

  it("the git bar opens the Console", async () => {
    h.repo = repo();
    render(<App />);
    await openApp();
    await userEvent.click(await screen.findByRole("button", { name: /Console/, description: "Run git or anything else in a terminal" }));
    await waitFor(() => expect(h.api.startTerminal).toHaveBeenCalledWith("a1", "console-a1:1"));
  });

  it("deleting an app stops its running consoles first", async () => {
    render(<App />);
    await openApp();
    await userEvent.click(tab());
    await emit({ terminalId: "console-a1:1", appId: "a1", state: { kind: "running" } });
    h.api.stopTerminal.mockImplementation(async () => {
      h.stateCb?.({ terminalId: "console-a1:1", appId: "a1", state: { kind: "stopped" } });
    });
    await userEvent.click(screen.getByRole("button", { name: "Edit Qonsol" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete app" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(h.api.stopTerminal).toHaveBeenCalledWith("a1", "console-a1:1"));
    await waitFor(() => expect(h.api.saveApps).toHaveBeenCalledWith([]));
  });

  it("a running console marks the app as running on Home", async () => {
    render(<App />);
    await openApp();
    await userEvent.click(tab());
    await emit({ terminalId: "console-a1:1", appId: "a1", state: { kind: "running" } });
    await userEvent.click(screen.getByRole("button", { name: /Home/ }));
    expect(await screen.findByRole("region", { name: "Running now" })).toBeInTheDocument();
  });
});

describe("Left pane, refresh and shells", () => {
  it("the sidebar collapses to a rail and back (button and Ctrl+B) and is remembered", async () => {
    localStorage.clear();
    const { unmount } = render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    expect(screen.getByRole("navigation", { name: "Apps" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(screen.getByRole("navigation", { name: "Apps (collapsed)" })).toBeInTheDocument();
    await userEvent.keyboard("{Control>}b{/Control}");
    expect(screen.getByRole("navigation", { name: "Apps" })).toBeInTheDocument();
    await userEvent.keyboard("{Control>}b{/Control}");
    expect(screen.getByRole("navigation", { name: "Apps (collapsed)" })).toBeInTheDocument();
    unmount();
    render(<App />); // remembered across launches
    await screen.findByRole("heading", { name: "Home", level: 2 });
    expect(screen.getByRole("navigation", { name: "Apps (collapsed)" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    localStorage.clear();
  });

  it("the Refresh button and F5 re-read terminal states and git now", async () => {
    h.repo = repo();
    render(<App />);
    await openApp();
    await screen.findByRole("button", { name: /Switch branch/ });
    const states = h.api.terminalStates.mock.calls.length;
    const info = h.api.gitInfo.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "Refresh everything" }));
    await waitFor(() => expect(h.api.terminalStates.mock.calls.length).toBe(states + 1));
    await waitFor(() => expect(h.api.gitInfo.mock.calls.length).toBeGreaterThan(info));
    const info2 = h.api.gitInfo.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "Refresh" })); // the one next to the git buttons
    await waitFor(() => expect(h.api.gitInfo.mock.calls.length).toBeGreaterThan(info2));
    const info3 = h.api.gitInfo.mock.calls.length;
    await userEvent.keyboard("{F5}");
    await waitFor(() => expect(h.api.gitInfo.mock.calls.length).toBeGreaterThan(info3));
  });

  it("the header lists the installed shells and saves the choice", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    const select = screen.getByLabelText("Shell") as HTMLSelectElement;
    await waitFor(() => expect([...select.options].map((o) => o.value)).toContain("gitbash"));
    expect([...select.options].map((o) => o.textContent)).toEqual(["Windows PowerShell", "PowerShell 7", "Git Bash"]);
    await userEvent.selectOptions(select, "gitbash");
    expect(h.api.setShell).toHaveBeenCalledWith("gitbash");
  });

  it("a saved shell that is no longer installed is shown as not found instead of silently changed", async () => {
    h.view = { ...view(), config: { ...view().config, shell: "wsl.exe" } };
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await waitFor(() => expect(screen.getByRole("option", { name: "wsl.exe (not found)" })).toBeInTheDocument());
  });
});

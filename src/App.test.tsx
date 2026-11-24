import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigView, StatePayload } from "./state/model";

type Handler<T> = (v: T) => void;
const h = vi.hoisted(() => ({
  stateCb: null as null | ((p: unknown) => void),
  closeCb: null as null | ((n: number) => void),
  view: null as unknown,
  states: [] as unknown[],
  api: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock("./api/tauri", () => {
  const fns = [
    "getConfig", "saveApps", "setTheme", "setShell", "setLastRunning", "ackConfig", "terminalStates", "startTerminal",
    "stopTerminal", "restartTerminal", "startAll", "stopAll", "writeInput", "resize", "openConfigFolder", "quitApp",
  ];
  for (const f of fns) h.api[f] = vi.fn(async () => undefined);
  for (const f of ["detectProject", "suggestCommands", "listSubfolders", "dockerContainers"]) h.api[f] = vi.fn(async () => []);
  for (const f of ["touchApp", "setFavourite"]) h.api[f] = vi.fn(async () => undefined);
  h.api.pathsExist = vi.fn(async (paths: string[]) => paths.map(() => true));
  h.api.gitInfo = vi.fn(async () => null);
  h.api.listShells = vi.fn(async () => [
    { id: "powershell.exe", name: "Windows PowerShell", path: "a" },
    { id: "pwsh.exe", name: "PowerShell 7", path: "b" },
  ]);
  h.api.getConfig = vi.fn(async () => h.view);
  h.api.terminalStates = vi.fn(async () => h.states);
  return {
    api: h.api,
    attachTerminal: vi.fn(async () => undefined),
    onTerminalState: vi.fn(async (cb: Handler<unknown>) => ((h.stateCb = cb), () => {})),
    onCloseRequested: vi.fn(async (cb: Handler<number>) => ((h.closeCb = cb), () => {})),
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
const baseView = (over: Partial<ConfigView["config"]> = {}, status: Partial<ConfigView["status"]> = {}): ConfigView => ({
  config: {
    version: 1,
    theme: "dark",
    shell: "powershell.exe",
    lastRunning: [],
    apps: [{ id: "a1", name: "Qonsol", root: "E:\\q", terminals: [T("t1", "db"), T("t2", "api")] }],
    ...over,
  },
  status: { locked: false, permanent: false, message: null, path: "C:\\cfg\\lite-commander.json", ...status },
  jobWarning: null,
});

async function openApp(name = "Qonsol") {
  const buttons = await screen.findAllByRole("button", { name: `Open ${name}` });
  await userEvent.click(buttons[0]);
  await screen.findByRole("heading", { name, level: 2 });
}

beforeEach(() => {
  Object.values(h.api).forEach((f) => f.mockClear());
  h.view = baseView();
  h.states = [];
  document.documentElement.dataset.theme = "";
});

describe("App", () => {
  it("T1: first launch shows the empty state with an Add your first app button", async () => {
    h.view = baseView({ apps: [] });
    render(<App />);
    expect(await screen.findByText(/No apps yet/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add your first app" }));
    expect(screen.getByRole("complementary", { name: "Add app" })).toBeInTheDocument();
  });

  it("applies the saved theme and toggles it through Rust", async () => {
    h.view = baseView({ theme: "light" });
    render(<App />);
    await openApp();
    expect(document.documentElement.dataset.theme).toBe("light");
    await userEvent.click(screen.getByRole("button", { name: "Toggle theme" }));
    expect(h.api.setTheme).toHaveBeenCalledWith("dark");
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
  });

  it("shows the selected app and mounts a terminal host that is visible only for the selected tab", async () => {
    render(<App />);
    await openApp();
    await waitFor(() => expect(screen.getByTestId("host-t1").dataset.visible).toBe("true"));
    await userEvent.click(screen.getByRole("tab", { name: /api/ }));
    await waitFor(() => expect(screen.getByTestId("host-t2").dataset.visible).toBe("true"));
    // the first stays mounted (kept alive) but hidden
    expect(screen.getByTestId("host-t1").dataset.visible).toBe("false");
  });

  it("Start all calls Rust and the button flips to Stop all when Rust reports a running terminal", async () => {
    render(<App />);
    await openApp();
    await userEvent.click(screen.getByRole("button", { name: /Start all/ }));
    expect(h.api.startAll).toHaveBeenCalledWith("a1");
    h.stateCb?.({ terminalId: "t2", appId: "a1", state: { kind: "running" } } satisfies StatePayload);
    expect(await screen.findByRole("button", { name: /Stop all/ })).toBeInTheDocument();
  });

  it("T22: offers to restore last running apps; No, thanks starts nothing", async () => {
    h.view = baseView({ lastRunning: ["a1", "gone"] });
    render(<App />);
    const dlg = await screen.findByRole("dialog", { name: /Start the apps that were running last time/ });
    expect(dlg).toHaveTextContent("Qonsol");
    await userEvent.click(screen.getByRole("button", { name: "No, thanks" }));
    expect(h.api.startAll).not.toHaveBeenCalled();
    expect(h.api.setLastRunning).toHaveBeenCalledWith([]);
  });

  it("T22: Start them starts the remembered apps", async () => {
    h.view = baseView({ lastRunning: ["a1"] });
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Start them" }));
    expect(h.api.startAll).toHaveBeenCalledWith("a1");
  });

  it("never offers a restore while a config problem is unacknowledged", async () => {
    h.view = baseView({ lastRunning: ["a1"] }, { locked: true, message: "Your saved apps could not be read." });
    render(<App />);
    await screen.findByText(/could not be read/);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("T16: locked config shows the path with Open folder and Continue", async () => {
    h.view = baseView({}, { locked: true, message: "Your saved apps could not be read (bad json)." });
    render(<App />);
    await screen.findByText(/could not be read/);
    expect(screen.getByText("C:\\cfg\\lite-commander.json")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open folder" }));
    expect(h.api.openConfigFolder).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(h.api.ackConfig).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText(/could not be read/)).toBeNull());
  });

  it("a permanently locked (newer version) config offers no Continue", async () => {
    h.view = baseView({}, { locked: true, permanent: true, message: "written by a newer version" });
    render(<App />);
    await screen.findByText(/newer version/);
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
  });

  it("T8/T9: close request asks Stop and quit (default) or Keep running", async () => {
    render(<App />);
    await openApp();
    h.closeCb?.(2);
    const dlg = await screen.findByRole("dialog", { name: "Quit Lite Commander?" });
    expect(dlg).toHaveTextContent("2 terminals are running");
    expect(screen.getByRole("button", { name: "Stop and quit" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Keep running" }));
    expect(h.api.quitApp).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    h.closeCb?.(1);
    await userEvent.click(await screen.findByRole("button", { name: "Stop and quit" }));
    expect(h.api.quitApp).toHaveBeenCalledWith(true);
  });

  it("T19: deleting an app asks for confirmation and then saves without it", async () => {
    render(<App />);
    await openApp();
    await userEvent.click(screen.getByRole("button", { name: "Edit Qonsol" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete app" }));
    expect(screen.getByRole("dialog", { name: "Delete Qonsol?" })).toBeInTheDocument();
    expect(h.api.saveApps).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(h.api.saveApps).toHaveBeenCalledWith([]));
  });

  it("T19: removing a running terminal asks first, stops it, then saves", async () => {
    h.states = [{ terminalId: "t2", appId: "a1", state: { kind: "running" } }];
    render(<App />);
    await openApp();
    await userEvent.click(screen.getByRole("button", { name: "Edit Qonsol" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove terminal 2" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("dialog", { name: "Stop running terminals?" })).toBeInTheDocument();
    expect(h.api.saveApps).not.toHaveBeenCalled();
    h.api.stopTerminal.mockImplementation(async () => {
      h.stateCb?.({ terminalId: "t2", appId: "a1", state: { kind: "stopped" } });
    });
    await userEvent.click(screen.getByRole("button", { name: "Stop and save" }));
    await waitFor(() => expect(h.api.stopTerminal).toHaveBeenCalledWith("a1", "t2"));
    await waitFor(() => expect(h.api.saveApps).toHaveBeenCalled());
  });

  it("T18: adding a terminal to a running app saves without stopping anything", async () => {
    h.states = [{ terminalId: "t1", appId: "a1", state: { kind: "running" } }];
    render(<App />);
    await openApp();
    await userEvent.click(screen.getByRole("button", { name: "Edit Qonsol" }));
    await userEvent.click(screen.getByRole("button", { name: "+ Add a terminal" }));
    await userEvent.type(screen.getByLabelText("Terminal 3 name"), "web");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.api.saveApps).toHaveBeenCalled());
    expect(h.api.stopTerminal).not.toHaveBeenCalled();
  });

  it("an app with no terminals shows its own empty state", async () => {
    h.view = baseView({ apps: [{ id: "a1", name: "Empty", root: "C:\\e", terminals: [] }] });
    render(<App />);
    await openApp("Empty");
    expect(await screen.findByText("This app has no terminals.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a terminal" })).toBeInTheDocument();
  });

  it("shell choice is saved through Rust", async () => {
    render(<App />);
    await openApp();
    await userEvent.selectOptions(screen.getByLabelText("Shell"), "pwsh.exe");
    expect(h.api.setShell).toHaveBeenCalledWith("pwsh.exe");
  });
});

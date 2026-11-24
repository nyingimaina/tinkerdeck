import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigView } from "./state/model";

const h = vi.hoisted(() => ({
  view: null as unknown,
  api: {} as Record<string, ReturnType<typeof vi.fn>>,
  ed: {} as Record<string, ReturnType<typeof vi.fn>>,
  surface: { loaded: 0 },
}));

vi.mock("./api/tauri", () => {
  for (const n of [
    "saveApps", "setTheme", "setShell", "setLastRunning", "ackConfig", "startTerminal", "stopTerminal", "restartTerminal",
    "startAll", "stopAll", "writeInput", "resize", "openConfigFolder", "quitApp", "touchApp", "setFavourite", "setUpdateSettings",
  ]) h.api[n] = vi.fn(async () => undefined);
  for (const n of ["detectProject", "suggestCommands", "listSubfolders", "dockerContainers", "listShells"]) h.api[n] = vi.fn(async () => []);
  h.api.getConfig = vi.fn(async () => h.view);
  h.api.terminalStates = vi.fn(async () => []);
  h.api.pathsExist = vi.fn(async (p: string[]) => p.map(() => true));
  h.api.gitInfo = vi.fn(async () => null);
  h.api.checkUpdate = vi.fn(async () => null);
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

vi.mock("./api/editor", () => {
  for (const n of ["list", "open", "newDoc", "load", "snapshot", "save", "close", "restore", "discard", "takePending", "touch", "pickOpenPaths", "pickSavePath"])
    h.ed[n] = vi.fn();
  h.ed.onOpen = vi.fn(async () => () => {});
  return { editorApi: h.ed };
});

vi.mock("./features/terminals/TerminalHost", () => ({ TerminalHost: () => <div /> }));
vi.mock("./features/editor/CodeSurface", () => {
  h.surface.loaded += 1;
  return { default: (p: { value: string }) => <div data-testid="surface">{p.value}</div> };
});

import { App } from "./App";

const view = (): ConfigView => ({
  config: {
    version: 1, theme: "dark", shell: "powershell.exe", lastRunning: [],
    apps: [{ id: "a1", name: "Qonsol", root: "E:\\q", terminals: [{ id: "t1", name: "api", cwd: ".", command: "", env: {} }] }],
  },
  status: { locked: false, permanent: false, message: null, path: "C:\\cfg.json" },
  jobWarning: null,
});

beforeEach(() => {
  h.view = view();
  h.surface.loaded = 0;
  for (const f of Object.values(h.ed)) f.mockReset();
  h.ed.list.mockResolvedValue({ open: [], bin: [] });
  h.ed.takePending.mockResolvedValue([]);
  h.ed.onOpen.mockImplementation(async () => () => {});
  h.ed.touch.mockResolvedValue(undefined);
});

describe("the editor inside the app", () => {
  it("is one click from the header, and the heavy part is not loaded until a file is open", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    expect(h.surface.loaded).toBe(0);
    await userEvent.click(screen.getByRole("button", { name: "Editor" }));
    expect(await screen.findByRole("button", { name: "Open…" })).toBeTruthy();
    expect(h.surface.loaded).toBe(0); // an empty editor still has not loaded CodeMirror
    await userEvent.click(screen.getByRole("button", { name: "Editor" })); // second click goes back
    expect(await screen.findByRole("heading", { name: "Home", level: 2 })).toBeTruthy();
  });

  it("a file sent from Explorer opens straight into the editor", async () => {
    h.ed.takePending.mockResolvedValue(["C:/x/notes.md"]);
    h.ed.open.mockResolvedValue({ id: "n", path: "C:/x/notes.md", title: "notes.md", content: "# hello", dirty: false, eol: "lf", encoding: "utf-8" });
    render(<App />);
    expect(await screen.findByRole("tab", { name: /notes\.md/ })).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("surface").textContent).toBe("# hello"));
    expect(h.surface.loaded).toBe(1);
  });

  it("works with no apps saved at all", async () => {
    h.view = { ...view(), config: { ...view().config, apps: [] } };
    render(<App />);
    await screen.findByText(/No apps yet/);
    await userEvent.click(screen.getByRole("button", { name: "Editor" }));
    expect(await screen.findByRole("button", { name: "Open…" })).toBeTruthy();
  });
});

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigView } from "./state/model";
import { BUILTIN_THEMES } from "./themes/builtin";
import type { Theme } from "./themes/types";

const h = vi.hoisted(() => ({
  view: null as unknown,
  store: { active: null as string | null, imported: [] as unknown[] },
  api: {} as Record<string, ReturnType<typeof vi.fn>>,
  th: {} as Record<string, ReturnType<typeof vi.fn>>,
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
vi.mock("./api/themes", () => {
  h.th.load = vi.fn(async () => h.store);
  h.th.save = vi.fn(async () => undefined);
  h.th.searchOnline = vi.fn();
  h.th.fetchOnline = vi.fn();
  h.th.scanLocal = vi.fn(async () => []);
  h.th.readLocal = vi.fn();
  return { themeApi: h.th };
});
vi.mock("./api/editor", () => ({ editorApi: { list: vi.fn(async () => ({ open: [], bin: [] })), takePending: vi.fn(async () => []), onOpen: vi.fn(async () => () => {}) } }));
vi.mock("./features/terminals/TerminalHost", () => ({ TerminalHost: () => <div /> }));

import { App } from "./App";

const view = (theme: "dark" | "light" = "dark"): ConfigView => ({
  config: {
    version: 1, theme, shell: "powershell.exe", lastRunning: [],
    apps: [{ id: "a1", name: "Qonsol", root: "E:\\q", terminals: [{ id: "t1", name: "api", cwd: ".", command: "", env: {} }] }],
  },
  status: { locked: false, permanent: false, message: null, path: "C:\\cfg.json" },
  jobWarning: null,
});

const imported: Theme = { ...BUILTIN_THEMES[0], id: "vsc-owl", name: "Night Owl", source: "vscode", ui: { ...BUILTIN_THEMES[0].ui, accent: "#7e57c2", bg: "#011627" } };

beforeEach(() => {
  h.view = view();
  h.store = { active: null, imported: [] };
  document.documentElement.removeAttribute("style");
  for (const f of [...Object.values(h.api), ...Object.values(h.th)]) f.mockClear?.();
  h.th.searchOnline.mockResolvedValue([]);
});

const openMenu = async () => {
  await screen.findByRole("heading", { name: "Home", level: 2 });
  await userEvent.click(screen.getByRole("button", { name: "Theme" }));
  return screen.getByRole("menu");
};

describe("themes in the app", () => {
  it("starts on the Tinkerdeck look", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await waitFor(() => expect(document.documentElement.style.getPropertyValue("--accent")).toBe(BUILTIN_THEMES[0].ui.accent));
  });

  it("lists the built-in themes in the header menu and switches the whole look", async () => {
    render(<App />);
    const menu = await openMenu();
    expect(within(menu).getAllByRole("menuitemradio").map((e) => e.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("Tinkerdeck Dark"), expect.stringContaining("Classic Light")]));
    await userEvent.click(within(menu).getByRole("menuitemradio", { name: /Tinkerdeck Light/ }));
    await waitFor(() => expect(document.documentElement.style.getPropertyValue("--bg")).toBe("#f4f1ea"));
    expect(h.api.setTheme).toHaveBeenCalledWith("light");
    expect(h.th.save).toHaveBeenCalledWith({ active: "tinkerdeck-light", imported: [] });
  });

  it("brings back an imported theme chosen last time", async () => {
    h.store = { active: "vsc-owl", imported: [imported] };
    render(<App />);
    await waitFor(() => expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#7e57c2"));
    const menu = await openMenu();
    expect(within(menu).getByRole("menuitemradio", { name: /Night Owl/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("finds a theme online and installs it with one click", async () => {
    h.th.searchOnline.mockResolvedValue([
      { id: "pub.owl", name: "Night Owl", publisher: "pub", description: "A theme", downloads: 12000, version: "1.0.0", icon: null, source: "online", location: "pub/owl" },
    ]);
    h.th.fetchOnline.mockResolvedValue({
      themes: [{ label: "Night Owl", uiTheme: "vs-dark", path: "t/n.json" }],
      files: { "t/n.json": JSON.stringify({ colors: { "editor.background": "#011627", "button.background": "#7e57c2" } }) },
    });
    render(<App />);
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Find more themes…" }));
    const dialog = await screen.findByRole("dialog", { name: "Find themes" });
    await userEvent.click(await within(dialog).findByRole("button", { name: "Install Night Owl" }));
    expect(await within(dialog).findByText("Installed")).toBeTruthy();
    expect(h.th.fetchOnline).toHaveBeenCalledWith("pub", "owl");
    await waitFor(() => expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#7e57c2"));
    expect(h.th.save).toHaveBeenLastCalledWith(expect.objectContaining({ active: expect.stringMatching(/^vsc-night-owl-/) }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Find themes" })).toBeNull();
  });

  it("the quick toggle still flips between dark and light", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await userEvent.click(screen.getByRole("button", { name: "Toggle theme" }));
    expect(h.api.setTheme).toHaveBeenCalledWith("light");
  });

  it("R3: Shell and Theme sit in the visible Appearance group, reachable without opening a dialog or the Utilities menu", async () => {
    h.api.listShells.mockResolvedValueOnce([
      { id: "powershell.exe", name: "Windows PowerShell", path: "a" },
      { id: "pwsh.exe", name: "PowerShell 7", path: "b" },
    ]);
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });

    const appearance = screen.getByRole("group", { name: "Appearance" });
    const shell = within(appearance).getByLabelText("Shell");
    const theme = within(appearance).getByRole("button", { name: "Theme" });
    expect(within(appearance).getByRole("button", { name: "Toggle theme" })).toBeInTheDocument();

    // Neither control is behind a dialog or the hidden Utilities menu.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();

    await within(appearance).findByRole("option", { name: "PowerShell 7" });
    await userEvent.selectOptions(shell, "pwsh.exe");
    expect(h.api.setShell).toHaveBeenCalledWith("pwsh.exe");

    await userEvent.click(theme);
    const menu = await within(appearance).findByRole("menu");
    expect(within(menu).getAllByRole("menuitemradio").length).toBeGreaterThan(0);
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigView, StatePayload } from "./state/model";

// The R1 plan is read through Vite's raw import so this test does not depend on Node types.
const planModules = import.meta.glob("../docs/ui-tidy-up-plan.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const tidyUpPlan = () => Object.values(planModules)[0] ?? "";

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
    "stopTerminal", "restartTerminal", "startAll", "stopAll", "writeInput", "resize", "openConfigFolder", "quitApp", "checkUpdate", "downloadUpdate", "applyUpdate", "setUpdateSettings",
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
    onUpdateProgress: vi.fn(async () => () => {}),
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

// Watches when each on-demand module is first evaluated, so a test can prove the initial view
// does not pull it in (R5). Factories return the real module, so behaviour is unchanged.
const lazyLoad = vi.hoisted(() => ({ atImport: true, loaded: [] as { name: string; atImport: boolean }[] }));

vi.mock("./features/terminals/ConsoleNav", async (importOriginal) => {
  lazyLoad.loaded.push({ name: "ConsoleNav", atImport: lazyLoad.atImport });
  return await importOriginal();
});
vi.mock("./features/apps/EditPane", async (importOriginal) => {
  lazyLoad.loaded.push({ name: "EditPane", atImport: lazyLoad.atImport });
  return await importOriginal();
});
vi.mock("./features/git/GitDrawer", async (importOriginal) => {
  lazyLoad.loaded.push({ name: "GitDrawer", atImport: lazyLoad.atImport });
  return await importOriginal();
});
vi.mock("./features/themes/ThemeFinder", async (importOriginal) => {
  lazyLoad.loaded.push({ name: "ThemeFinder", atImport: lazyLoad.atImport });
  return await importOriginal();
});
vi.mock("./features/command-palette/CommandPalette", async (importOriginal) => {
  lazyLoad.loaded.push({ name: "CommandPalette", atImport: lazyLoad.atImport });
  return await importOriginal();
});
vi.mock("./features/updates/UpdateUI", async (importOriginal) => {
  lazyLoad.loaded.push({ name: "UpdateUI", atImport: lazyLoad.atImport });
  return await importOriginal();
});

import { App } from "./App";
lazyLoad.atImport = false;

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
  status: { locked: false, permanent: false, message: null, path: "C:\\cfg\\tinkerdeck.json", ...status },
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
  localStorage.clear();
  document.documentElement.dataset.theme = "";
});

describe("App", () => {
  it("T1: first launch shows the empty state with an Add your first app button", async () => {
    h.view = baseView({ apps: [] });
    render(<App />);
    expect(await screen.findByText(/No apps yet/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add your first app" }));
    expect(await screen.findByRole("complementary", { name: "Add app" })).toBeInTheDocument();
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

  it("R5: the confirmation dialog bodies load only when a dialog opens, not with the initial view", async () => {
    render(<App />);
    await openApp();
    // Showing the app view does not pull in the confirm-dialog chunk.
    expect(lazyLoad.loaded.some((m) => m.name === "CommandPalette")).toBe(false);
    h.closeCb?.(1);
    expect(await screen.findByRole("dialog", { name: "Quit Tinkerdeck?" })).toBeInTheDocument();
    // It was evaluated now, on demand, not during App's import.
    expect(lazyLoad.loaded.find((m) => m.name === "CommandPalette")?.atImport).toBe(false);
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
    expect(screen.getByText("C:\\cfg\\tinkerdeck.json")).toBeInTheDocument();
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
    const dlg = await screen.findByRole("dialog", { name: "Quit Tinkerdeck?" });
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
    await userEvent.click(await screen.findByRole("button", { name: "Delete app" }));
    expect(await screen.findByRole("dialog", { name: "Delete Qonsol?" })).toBeInTheDocument();
    expect(h.api.saveApps).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(h.api.saveApps).toHaveBeenCalledWith([]));
  });

  it("T19: removing a running terminal asks first, stops it, then saves", async () => {
    h.states = [{ terminalId: "t2", appId: "a1", state: { kind: "running" } }];
    render(<App />);
    await openApp();
    await userEvent.click(screen.getByRole("button", { name: "Edit Qonsol" }));
    await userEvent.click(await screen.findByRole("button", { name: "Remove terminal 2" }));
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
    await userEvent.click(await screen.findByRole("button", { name: "+ Add a terminal" }));
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

  it("R1: the tidy-up plan names every screen, panel, dialog, footer element, top-bar control and shortcut", () => {
    const plan = tidyUpPlan();
    for (const name of [
      "Home",
      "App view",
      "Editor",
      "Sidebar",
      "AppHeader",
      "GitBar",
      "TabStrip",
      "TerminalHost",
      "ConsoleNav",
      "GitDrawer",
      "EditPane",
      "ThemeFinder",
      "Find themes",
      "Stop running terminals?",
      "Delete <app>?",
      "Close <console>?",
      "Switch to <branch>?",
      "Start the apps that were running last time?",
      "Quit Tinkerdeck?",
      "Update to <version>",
      "Help",
      "Config locked",
      "Job warning",
      "Update available",
      "Ctrl+B",
      "F5",
      "Ctrl+Shift+P",
      "Ctrl+Alt+T",
      "Ctrl+S",
      "Ctrl+O",
      "AppFooter",
    ]) {
      expect(plan, `${name} is missing from the plan`).toContain(name);
    }
  });

  it("R1: the plan states each part's group, default visibility, how it is hidden again, remembered state, entry, laziness and package choice", () => {
    const plan = tidyUpPlan();
    for (const phrase of [
      "Named group",
      "Shows by default",
      "Hidden again by",
      "State remembered",
      "Reached from",
      "Lazy",
      "Eager",
      "npm package",
      "Brand",
      "Appearance",
      "Create",
      "Utilities",
      "Two entry points, one home",
      "shortcut-first",
      "Gap today",
      "localStorage",
    ]) {
      expect(plan, `${phrase} is missing from the plan`).toContain(phrase);
    }
  });

  it("R1: the plan lists each part in exactly one inventory entry", () => {
    const plan = tidyUpPlan();
    const inventoryRows = plan
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^\|\s*(?:[SPDB]\d+|\d+)\s*\|/.test(line));
    expect(inventoryRows.length).toBeGreaterThan(20);
    const counts = new Map<string, number>();
    for (const row of inventoryRows) {
      for (const match of row.matchAll(/([A-Za-z0-9_-]+\.tsx)\b/g)) {
        counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
      }
    }
    for (const [file, count] of counts) {
      expect(count, `${file} is inventoried ${count} times`).toBe(1);
    }
  });

  it("R1: the plan records the running-app check from what was seen on screen instead of deferring it", () => {
    const plan = tidyUpPlan();
    expect(plan).toContain("Running-app verification");
    expect(plan).toContain("What was on screen");
    expect(plan).toContain("900×560");
    expect(plan).toContain("no part of the check is left to a later manual pass");
    expect(plan.toLowerCase()).not.toContain("merge gate");
  });

  it("R2: the persistent footer is visible on Home, the app view and the separate editor view", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    expect(screen.getByRole("contentinfo", { name: "Status" })).toHaveTextContent("v2.0.0");

    await openApp();
    expect(screen.getByRole("contentinfo", { name: "Status" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Utilities" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Editor" }));
    expect(await screen.findByRole("button", { name: "Open…" })).toBeInTheDocument();
    expect(screen.getByRole("contentinfo", { name: "Status" })).toBeInTheDocument();
  });

  it("R5: optional panels and the help/update dialog bodies are loaded only when opened, not with the initial view", async () => {
    expect(lazyLoad.loaded.filter((m) => m.atImport)).toEqual([]);

    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });

    await userEvent.click(screen.getByRole("button", { name: "Utilities" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Help" }));
    expect(await screen.findByRole("dialog", { name: "Help" })).toBeInTheDocument();

    // The Help body shares the palette's chunk, and it was evaluated now, not during App's import.
    expect(lazyLoad.loaded.find((m) => m.name === "CommandPalette")?.atImport).toBe(false);
  });

  it("R10: the palette uses the pinned cmdk package, loaded on demand and never with the initial view", async () => {
    // The palette module is never evaluated while App itself is imported: it is an on-demand chunk.
    expect(lazyLoad.loaded.filter((m) => m.atImport && m.name === "CommandPalette")).toEqual([]);

    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });

    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    // cmdk renders its own root, so the list is the package rather than a hand-rolled one.
    expect(dialog.querySelector("[cmdk-root]")).not.toBeNull();

    const packages = import.meta.glob("../package.json", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const pkg = JSON.parse(Object.values(packages)[0] ?? "{}") as { dependencies?: Record<string, string> };
    expect(pkg.dependencies?.cmdk).toBe("1.1.1");
  });

  it("R10: the plan records each building block's package or in-house choice with licence, maintenance and React 18.3 compatibility, and the jattac fallback", () => {
    const plan = tidyUpPlan();
    const section = plan.slice(plan.indexOf("## 15. Package decisions"));

    // The table has one row per building block (K1-K5) and confirms both the licence/maintenance
    // and the React 18.3 + Tauri WebView2 columns the acceptance depends on.
    expect(section).toContain("Licence / maintenance");
    expect(section).toContain("React 18.3 + Tauri WebView2");
    expect(section).toContain("Reused without replacement");

    const rows = section
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^\|\s*K[1-5]\s*\|/.test(line));
    expect(rows, "the plan must have one row for each building block K1-K5").toHaveLength(5);

    const cells = (row: string) => row.split("|").map((cell) => cell.trim());
    for (const id of ["K1", "K2", "K3", "K4", "K5"]) {
      const row = rows.find((line) => cells(line)[1] === id);
      expect(row, `${id} is missing from the package decisions table`).toBeDefined();
      const [, , block, decision, licence, react] = cells(row!);
      expect(block, `${id} names its building block`).not.toBe("");
      expect(decision, `${id} records a package or in-house decision`).not.toBe("");
      expect(licence, `${id} records licence and maintenance`).not.toBe("");
      expect(react, `${id} records React 18.3 + Tauri WebView2 compatibility`).not.toBe("");
      // Anything not taken from a package states that it is in-house, not left unstated.
      if (id !== "K1") expect(decision.toLowerCase()).toContain("in-house");
    }

    // K1 is the only package adopted, and it is the pinned cmdk with a free, maintained licence.
    const k1 = cells(rows.find((line) => cells(line)[1] === "K1")!);
    expect(k1[3]).toContain("cmdk 1.1.1");
    expect(k1[4]).toContain("MIT");
    expect(k1[4].toLowerCase()).toContain("maintained");

    // K3 records the published jattac overflow-menu package as unusable (missing styles file) and
    // states the fallback instead of forcing it in.
    const k3 = cells(rows.find((line) => cells(line)[1] === "K3")!);
    expect(k3[2]).toContain("Menus");
    expect(k3[3]).toContain("In-house");
    expect(k3[4]).toContain("jattac.libs.web.overflow-menu");
    expect(k3[4]).toContain("dist/index.css");
    expect(k3[4]).toContain("no such file");
  });

  it("R6: the footer toggle and Ctrl+B move the sidebar together and stay in step", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    const toggle = screen.getByRole("button", { name: "Toggle sidebar" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(toggle);
    expect(screen.getByRole("navigation", { name: "Apps (collapsed)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Toggle sidebar" })).toHaveAttribute("aria-pressed", "true");

    await userEvent.keyboard("{Control>}b{/Control}");
    expect(screen.getByRole("navigation", { name: "Apps" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Toggle sidebar" })).toHaveAttribute("aria-pressed", "false");

    await userEvent.keyboard("{Control>}b{/Control}");
    expect(screen.getByRole("navigation", { name: "Apps (collapsed)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Toggle sidebar" })).toHaveAttribute("aria-pressed", "true");
  });

  it("R6: a saved collapsed sidebar shows the footer toggle collapsed on the next start", async () => {
    localStorage.setItem("td.sidebarCollapsed", "1");
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    expect(screen.getByRole("navigation", { name: "Apps (collapsed)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Toggle sidebar" })).toHaveAttribute("aria-pressed", "true");
  });

  it("A2: an unexpected saved value starts expanded and only the existing sidebar key is written", async () => {
    localStorage.setItem("td.sidebarCollapsed", "maybe");
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    expect(screen.getByRole("navigation", { name: "Apps" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Toggle sidebar" })).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(screen.getByRole("button", { name: "Toggle sidebar" }));
    expect(localStorage.getItem("td.sidebarCollapsed")).toBe("1");
    expect(Object.keys(localStorage).sort()).toEqual(["td.sidebarCollapsed"]);
  });
});

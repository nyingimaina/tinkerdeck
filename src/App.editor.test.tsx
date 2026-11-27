import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigView } from "./state/model";

const h = vi.hoisted(() => ({
  view: null as unknown,
  api: {} as Record<string, ReturnType<typeof vi.fn>>,
  ed: {} as Record<string, ReturnType<typeof vi.fn>>,
  surface: { loaded: 0 },
  hosts: { mounts: 0, unmounts: 0 },
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

// A counted host: a test can tell a hidden-but-alive terminal from one that was remounted (A1).
vi.mock("./features/terminals/TerminalHost", async () => {
  const { useEffect } = await import("react");
  return {
    TerminalHost: ({ terminalId }: { terminalId: string }) => {
      useEffect(() => {
        h.hosts.mounts += 1;
        return () => {
          h.hosts.unmounts += 1;
        };
      }, []);
      return <div data-testid={`host-${terminalId}`} />;
    },
  };
});
vi.mock("./features/editor/CodeSurface", () => {
  h.surface.loaded += 1;
  return { default: (p: { value: string }) => <div data-testid="surface">{p.value}</div> };
});

// The Files explorer reads one level per root; a quiet empty listing keeps these suites as they were (A3).
vi.mock("./api/explorer", () => ({
  explorerApi: {
    list: vi.fn(async (path: string) => ({ path, entries: [], total: 0, truncated: false, locked: false })),
    drives: vi.fn(async () => []),
    home: vi.fn(async () => null),
  },
}));

import { App } from "./App";

/** The Editor command now lives in the Utilities menu. */
async function toggleEditor() {
  await userEvent.click(screen.getByRole("button", { name: "Utilities" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Editor" }));
}

const view = (): ConfigView => ({
  config: {
    version: 1, theme: "dark", shell: "powershell.exe", lastRunning: [],
    apps: [{ id: "a1", name: "Qonsol", root: "E:\\q", terminals: [{ id: "t1", name: "api", cwd: ".", command: "", env: {} }] }],
  },
  status: { locked: false, permanent: false, message: null, path: "C:\\cfg.json" },
  jobWarning: null,
});

const entry = (id: string, path: string, title = id) => ({
  id,
  path,
  title,
  dirty: false,
  eol: "lf",
  encoding: "utf-8",
});
const doc = (id: string, path: string, content = "text", title = id) => ({
  id,
  path,
  title,
  content,
  dirty: false,
  eol: "lf",
  encoding: "utf-8",
});

/** The command palette's Open file… runs the editor's one picker path from any view (R1). */
async function openFromPalette() {
  fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
  const dialog = await screen.findByRole("dialog", { name: "Command palette" }, { timeout: 5000 });
  await userEvent.click(within(dialog).getByRole("button", { name: /Open file/ }));
  await waitFor(() => expect(h.ed.pickOpenPaths).toHaveBeenCalled());
}

beforeEach(() => {
  h.view = view();
  h.surface.loaded = 0;
  h.hosts.mounts = 0;
  h.hosts.unmounts = 0;
  for (const f of Object.values(h.ed)) f.mockReset();
  h.ed.list.mockResolvedValue({ open: [], bin: [] });
  h.ed.takePending.mockResolvedValue([]);
  h.ed.onOpen.mockImplementation(async () => () => {});
  h.ed.touch.mockResolvedValue(undefined);
  h.ed.load.mockImplementation(async (id: string) => doc(id, `C:/x/${id}.txt`));
  h.api.getConfig.mockImplementation(async () => h.view);
});

describe("the editor inside the app", () => {
  it("is one click from the header, and the heavy part is not loaded until a file is open", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    expect(h.surface.loaded).toBe(0);
    await toggleEditor();
    expect(await screen.findByRole("button", { name: "Open…" })).toBeTruthy();
    expect(h.surface.loaded).toBe(0); // an empty editor still has not loaded CodeMirror
    await toggleEditor(); // second click goes back
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
    await toggleEditor();
    expect(await screen.findByRole("button", { name: "Open…" })).toBeTruthy();
  });
});

describe("workspace-owned files open in their workspace strip (R1, R2, R4, R5, A1)", () => {
  it("R1/R5: a workspace-owned file opened from the global view moves to the workspace strip, with no side pane", async () => {
    h.ed.pickOpenPaths.mockResolvedValue(["E:/q/a.ts"]);
    h.ed.open.mockResolvedValue(doc("a", "E:/q/a.ts", "alpha", "a.ts"));
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await toggleEditor();
    await openFromPalette();

    const tab = await screen.findByRole("tab", { name: /a\.ts/ });
    expect(tab).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("heading", { name: "Qonsol", level: 2 })).toBeInTheDocument();
    // The workspace strip is the only tab list; the old grouped "Open editors" pane is gone (R5).
    expect(screen.queryByRole("tablist", { name: "Open editors" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open…" })).toBeNull();
    // Its terminal tabs stay beside it in the same strip (R1).
    expect(screen.getByRole("tab", { name: /api/ })).toBeInTheDocument();
  });

  it("A1: switching editor tab → terminal tab → editor tab keeps the one editor surface mounted", async () => {
    h.ed.pickOpenPaths.mockResolvedValue(["E:/q/a.ts"]);
    h.ed.open.mockResolvedValue(doc("a", "E:/q/a.ts", "alpha", "a.ts"));
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await toggleEditor();
    await openFromPalette();

    const surface = await screen.findByTestId("surface");
    expect(surface.textContent).toBe("alpha");

    await userEvent.click(screen.getByRole("tab", { name: /api/ }));
    expect(screen.getByTestId("surface")).toBe(surface); // hidden, never re-created

    await userEvent.click(screen.getByRole("tab", { name: /a\.ts/ }));
    expect(screen.getByTestId("surface")).toBe(surface);
  });

  it("A1: showing a file tab keeps the same terminal host mounted and never stops or restarts it", async () => {
    h.ed.pickOpenPaths.mockResolvedValue(["E:/q/a.ts"]);
    h.ed.open.mockResolvedValue(doc("a", "E:/q/a.ts", "alpha", "a.ts"));
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await toggleEditor();
    await openFromPalette();
    await screen.findByRole("tab", { name: /a\.ts/ });

    // The workspace's terminal host exists once its workspace is on screen.
    const host = await screen.findByTestId("host-t1");
    await waitFor(() => expect(h.hosts.mounts).toBe(1));
    h.api.startTerminal.mockClear();
    h.api.stopTerminal.mockClear();
    h.api.restartTerminal.mockClear();

    // Editor tab -> terminal tab -> editor tab: the same DOM node survives, no remount (A1).
    await userEvent.click(screen.getByRole("tab", { name: /a\.ts/ }));
    expect(screen.getByTestId("host-t1")).toBe(host);
    await userEvent.click(screen.getByRole("tab", { name: /api/ }));
    expect(screen.getByTestId("host-t1")).toBe(host);
    await userEvent.click(screen.getByRole("tab", { name: /a\.ts/ }));
    expect(screen.getByTestId("host-t1")).toBe(host);

    expect(h.hosts.mounts).toBe(1);
    expect(h.hosts.unmounts).toBe(0);
    expect(h.api.stopTerminal).not.toHaveBeenCalled();
    expect(h.api.restartTerminal).not.toHaveBeenCalled();
    expect(h.api.startTerminal).not.toHaveBeenCalled();
  });

  it("REV-2/R1: a workspace-owned file that cannot be read shows its existing message in the workspace and opens no tab", async () => {
    h.ed.pickOpenPaths.mockResolvedValue(["E:/q/huge.log"]);
    h.ed.open.mockRejectedValue(new Error("This file is too large to edit here (limit 5 MB)."));
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await userEvent.click((await screen.findAllByRole("button", { name: "Open Qonsol" }))[0]);
    await screen.findByRole("heading", { name: "Qonsol", level: 2 });

    await openFromPalette();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This file is too large to edit here (limit 5 MB).");
    // The workspace view stays on screen and no editor tab was created for the unreadable file (R1).
    expect(screen.getByRole("heading", { name: "Qonsol", level: 2 })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /huge\.log/ })).toBeNull();

    await userEvent.click(within(alert).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("REV-3/R1: an unrelated editor failure is not shown as a workspace file alert", async () => {
    // The editor's startup list() failing is not a failed open of a workspace-owned file, so the
    // workspace must not surface it as its own "file cannot be read" alert (REV-3, QA-10).
    h.ed.list.mockRejectedValue(new Error("TypeError: Cannot read properties of undefined (reading 'invoke')"));
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await userEvent.click((await screen.findAllByRole("button", { name: "Open Qonsol" }))[0]);
    await screen.findByRole("heading", { name: "Qonsol", level: 2 });

    await waitFor(() => expect(h.ed.list).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("REV-3/R1: a failed open is only shown in the workspace that owns the file, never in another", async () => {
    const cfg = view();
    h.view = {
      ...cfg,
      config: {
        ...cfg.config,
        apps: [
          ...cfg.config.apps,
          { id: "b1", name: "Bees", root: "E:\\b", terminals: [{ id: "t2", name: "web", cwd: ".", command: "", env: {} }] },
        ],
      },
    };
    h.ed.pickOpenPaths.mockResolvedValue(["E:/b/x.ts"]);
    h.ed.open.mockRejectedValue(new Error("This file is too large to edit here (limit 5 MB)."));
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await userEvent.click((await screen.findAllByRole("button", { name: "Open Qonsol" }))[0]);
    await screen.findByRole("heading", { name: "Qonsol", level: 2 });

    // The unreadable file belongs to Bees, so Qonsol must not claim its error (REV-3).
    await openFromPalette();
    await waitFor(() => expect(h.ed.open).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();

    // Visiting the owning workspace shows it there instead.
    await userEvent.click(await screen.findByRole("button", { name: /^Bees/ }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This file is too large to edit here (limit 5 MB).");
  });

  it("R2: an unowned file opened while a workspace is on screen opens the global view, not the workspace strip", async () => {
    h.ed.pickOpenPaths.mockResolvedValue(["C:/loose/notes.txt"]);
    h.ed.open.mockResolvedValue(doc("n", "C:/loose/notes.txt", "loose", "notes.txt"));
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await userEvent.click((await screen.findAllByRole("button", { name: "Open Qonsol" }))[0]);
    await screen.findByRole("heading", { name: "Qonsol", level: 2 });

    await openFromPalette();

    expect(await screen.findByRole("button", { name: "Open…" })).toBeInTheDocument();
    expect(await screen.findByRole("tab", { name: /notes\.txt/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: /api/ })).toBeNull(); // the workspace strip is gone
  });

  it("SEC-1: entering the global view with a remembered workspace editor tab does not loop between the two selection effects", async () => {
    // An unowned tab is already open when the workspace file becomes the remembered selection.
    h.ed.list.mockResolvedValue({ open: [entry("u", "C:/tmp/u.txt", "u.txt")], bin: [] });
    h.ed.load.mockImplementation(async () => doc("u", "C:/tmp/u.txt", "loose", "u.txt"));
    h.ed.pickOpenPaths.mockResolvedValue(["E:/q/a.ts"]);
    h.ed.open.mockResolvedValue(doc("a", "E:/q/a.ts", "alpha", "a.ts"));
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await userEvent.click((await screen.findAllByRole("button", { name: "Open Qonsol" }))[0]);
    await screen.findByRole("heading", { name: "Qonsol", level: 2 });

    // Opening a workspace-owned file remembers its tab for that workspace (R1, R4).
    await openFromPalette();
    expect(await screen.findByRole("tab", { name: /a\.ts/ })).toHaveAttribute("aria-selected", "true");

    // Pressing the header Editor button shows the global view while that workspace tab stays
    // remembered. The two selection effects used to write different ids on every commit and loop
    // forever (SEC-1); it must settle on the unowned tab instead.
    await toggleEditor();
    const u = await screen.findByRole("tab", { name: /u\.txt/ });
    expect(u).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: /a\.ts/ })).toBeNull();
    expect(screen.getByTestId("surface").textContent).toBe("loose");
  });

  it("A2: the global view selects an unowned tab even when a workspace file is the active document", async () => {
    h.ed.list.mockResolvedValue({ open: [entry("a", "E:/q/a.ts", "a.ts"), entry("u", "C:/tmp/u.txt", "u.txt")], bin: [] });
    h.ed.load.mockImplementation(async (id: string) => doc(id, id === "a" ? "E:/q/a.ts" : "C:/tmp/u.txt", id, `${id}.txt`));
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await toggleEditor();

    const u = await screen.findByRole("tab", { name: /u\.txt/ });
    expect(u).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: /a\.ts/ })).toBeNull();
  });
});

describe("a file opened before the saved workspaces load (A3)", () => {
  it("A3: a pending workspace-owned file is filed under its workspace once they load", async () => {
    let resolveConfig: (v: unknown) => void = () => {};
    h.api.getConfig.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveConfig = resolve;
        }),
    );
    h.ed.takePending.mockResolvedValue(["E:/q/a.ts"]);
    h.ed.open.mockResolvedValue(doc("a", "E:/q/a.ts", "alpha", "a.ts"));

    render(<App />);
    await waitFor(() => expect(h.ed.open).toHaveBeenCalledWith("E:/q/a.ts"));

    await act(async () => {
      resolveConfig(view());
    });

    const tab = await screen.findByRole("tab", { name: /a\.ts/ });
    expect(tab).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("heading", { name: "Qonsol", level: 2 })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open…" })).toBeNull();
  });

  it("A3: a pending file outside every workspace root opens the global view and is selected there", async () => {
    let resolveConfig: (v: unknown) => void = () => {};
    h.api.getConfig.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveConfig = resolve;
        }),
    );
    h.ed.takePending.mockResolvedValue(["C:/loose/notes.txt"]);
    h.ed.open.mockResolvedValue(doc("n", "C:/loose/notes.txt", "loose", "notes.txt"));

    render(<App />);
    await waitFor(() => expect(h.ed.open).toHaveBeenCalledWith("C:/loose/notes.txt"));

    await act(async () => {
      resolveConfig(view());
    });

    expect(await screen.findByRole("button", { name: "Open…" })).toBeInTheDocument();
    expect(await screen.findByRole("tab", { name: /notes\.txt/ })).toHaveAttribute("aria-selected", "true");
  });
});

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigView } from "./state/model";
import type { ExplorerEntry, ExplorerListing } from "./api/explorer";

const h = vi.hoisted(() => ({
  view: null as unknown,
  api: {} as Record<string, ReturnType<typeof vi.fn>>,
  ed: {} as Record<string, ReturnType<typeof vi.fn>>,
  ex: {
    list: vi.fn(),
    drives: vi.fn(),
    home: vi.fn(),
    create: vi.fn(),
    rename: vi.fn(),
    move: vi.fn(),
    remove: vi.fn(),
  },
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
  for (const n of ["list", "open", "newDoc", "load", "snapshot", "save", "close", "restore", "discard", "takePending", "touch", "readBytes", "pickOpenPaths", "pickSavePath"])
    h.ed[n] = vi.fn();
  h.ed.onOpen = vi.fn(async () => () => {});
  return { editorApi: h.ed };
});

vi.mock("./api/explorer", () => ({ explorerApi: h.ex }));

vi.mock("./state/fileKinds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./state/fileKinds")>();
  return { ...actual, detectKind: vi.fn(actual.detectKind) };
});

vi.mock("./features/terminals/TerminalHost", () => ({ TerminalHost: () => <div /> }));
vi.mock("./features/editor/CodeSurface", () => ({
  default: ({
    docId,
    value,
    onChange,
  }: {
    docId: string;
    value: string;
    onChange: (id: string, text: string) => void;
  }) => <textarea data-testid="surface" value={value} onChange={(e) => onChange(docId, e.target.value)} />,
}));

import { App } from "./App";
import { detectKind } from "./state/fileKinds";

const T = (id: string, name: string) => ({ id, name, cwd: ".", command: "", env: {} });

const view = (over: Partial<ConfigView["config"]> = {}): ConfigView => ({
  config: {
    version: 1,
    theme: "dark",
    shell: "powershell.exe",
    lastRunning: [],
    apps: [
      { id: "a1", name: "Qonsol", root: "E:\\q", terminals: [T("t1", "api")] },
      { id: "a2", name: "pdfer", root: "E:\\p", terminals: [] },
    ],
    ...over,
  },
  status: { locked: false, permanent: false, message: null, path: "C:\\cfg.json" },
  jobWarning: null,
});

const doc = (path: string, content = "text") => ({
  id: path,
  path,
  title: path.split(/[\\/]/).pop() ?? path,
  content,
  dirty: false,
  eol: "lf",
  encoding: "utf-8",
});
const entry = (path: string) => ({ id: path, path, title: path.split(/[\\/]/).pop() ?? path, dirty: false, eol: "lf", encoding: "utf-8" });

const file = (path: string): ExplorerEntry => ({ name: path.split(/[\\/]/).pop() ?? path, path, isDir: false, locked: false });
const folder = (path: string): ExplorerEntry => ({ name: path.split(/[\\/]/).pop() ?? path, path, isDir: true, locked: false });
const listing = (path: string, entries: ExplorerEntry[] = []): ExplorerListing => ({
  path,
  entries,
  total: entries.length,
  truncated: false,
  locked: false,
});

async function openApp(name = "Qonsol") {
  const buttons = await screen.findAllByRole("button", { name: `Open ${name}` });
  await userEvent.click(buttons[0]);
  await screen.findByRole("heading", { name, level: 2 });
}

async function openEditor() {
  await userEvent.click(screen.getByRole("button", { name: "Utilities" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Editor" }));
  await screen.findByRole("button", { name: "Open…" });
}

// The Files explorer is its own sidebar tab now, so it only mounts once that tab is chosen.
async function showFiles() {
  await userEvent.click(await screen.findByRole("tab", { name: "Files" }));
  return await screen.findByRole("region", { name: "Files" });
}

async function openPalette() {
  fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
  return await screen.findByRole("dialog", { name: "Command palette" }, { timeout: 5000 });
}

beforeEach(() => {
  h.view = view();
  for (const fn of Object.values(h.api)) fn.mockClear();
  for (const fn of Object.values(h.ed)) fn.mockReset();
  h.ed.list.mockResolvedValue({ open: [], bin: [] });
  h.ed.takePending.mockResolvedValue([]);
  h.ed.onOpen.mockImplementation(async () => () => {});
  h.ed.touch.mockResolvedValue(undefined);
  h.ed.load.mockImplementation(async (id: string) => doc(id, "loaded"));
  h.ed.pickOpenPaths.mockResolvedValue([]);
  for (const fn of Object.values(h.ex)) fn.mockReset();
  h.ex.list.mockImplementation(async (path: string) => listing(path));
  h.ex.drives.mockResolvedValue([{ name: "C:", path: "C:\\", isDir: true, locked: false }]);
  h.ex.home.mockResolvedValue(null);
  localStorage.clear();
});

describe("Open file… in the command palette", () => {
  it("R1: the home view offers it and choosing it opens the picked file in the editor view", async () => {
    h.ed.pickOpenPaths.mockResolvedValue(["E:/loose/notes.md"]);
    h.ed.open.mockResolvedValue(doc("E:/loose/notes.md", "# hi"));
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });

    const dialog = await openPalette();
    await userEvent.click(within(dialog).getByRole("button", { name: /Open file/ }));

    await waitFor(() => expect(h.ed.pickOpenPaths).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: "Open…" })).toBeInTheDocument();
    expect(await screen.findByRole("tab", { name: /notes\.md/ })).toBeInTheDocument();
    expect(h.ed.open).toHaveBeenCalledWith("E:/loose/notes.md");
  });

  it("R1: the entry is present in the app view too, and cancelling leaves the view and tabs unchanged", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openApp();

    const dialog = await openPalette();
    await userEvent.click(within(dialog).getByRole("button", { name: /Open file/ }));

    await waitFor(() => expect(h.ed.pickOpenPaths).toHaveBeenCalled());
    expect(h.ed.open).not.toHaveBeenCalled();
    expect(await screen.findByRole("heading", { name: "Qonsol", level: 2 })).toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: "Open editors" })).toBeNull();
  });

  it("R1: picking several files opens each one", async () => {
    h.ed.pickOpenPaths.mockResolvedValue(["E:/q/a.ts", "E:/q/b.ts"]);
    h.ed.open.mockImplementation(async (p: string) => doc(p));
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    const dialog = await openPalette();
    await userEvent.click(within(dialog).getByRole("button", { name: /Open file/ }));

    expect(await screen.findByRole("tab", { name: /a\.ts/ })).toBeInTheDocument();
    expect(await screen.findByRole("tab", { name: /b\.ts/ })).toBeInTheDocument();
    expect(h.ed.open).toHaveBeenCalledTimes(2);
  });

  it("R1: opening a file while another tab has unsaved text keeps that text", async () => {
    h.ed.takePending.mockResolvedValue(["E:/q/a.ts"]);
    h.ed.open.mockImplementation(async (p: string) => doc(p, "alpha"));
    h.ed.pickOpenPaths.mockResolvedValue(["E:/q/b.ts"]);
    render(<App />);
    const surface = () => screen.getByTestId("surface") as HTMLTextAreaElement;
    await waitFor(() => expect(surface().value).toBe("alpha"));

    await userEvent.type(surface(), " typed");
    expect(surface().value).toBe("alpha typed");

    const dialog = await openPalette();
    await userEvent.click(within(dialog).getByRole("button", { name: /Open file/ }));
    expect(await screen.findByRole("tab", { name: /b\.ts/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: /a\.ts/ }));
    expect(await screen.findByTestId("surface")).toHaveValue("alpha typed");
  });

  it("R1: the editor's Open. button, Ctrl+O and the empty-state button still run the same picker", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openEditor();

    await userEvent.click(screen.getByRole("button", { name: "Open a file…" }));
    await waitFor(() => expect(h.ed.pickOpenPaths).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole("button", { name: "Open…" }));
    await waitFor(() => expect(h.ed.pickOpenPaths).toHaveBeenCalledTimes(2));

    fireEvent.keyDown(window, { key: "o", ctrlKey: true });
    await waitFor(() => expect(h.ed.pickOpenPaths).toHaveBeenCalledTimes(3));
  });
});

describe("opening files from the Files explorer", () => {
  it("R3: clicking a file opens it through the editor's open path and shows the editor view", async () => {
    h.ex.list.mockImplementation(async (path: string) =>
      path === "E:\\q" ? listing(path, [folder("E:\\q\\src"), file("E:\\q\\README.md")]) : listing(path),
    );
    h.ed.open.mockResolvedValue(doc("E:\\q\\README.md", "# readme"));
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openApp();
    const files = await showFiles();

    await userEvent.click(within(files).getByTitle("E:\\q\\README.md"));

    expect(await screen.findByRole("button", { name: "Open…" })).toBeInTheDocument();
    expect(await screen.findByRole("tab", { name: /README\.md/ })).toBeInTheDocument();
    expect(h.ed.open).toHaveBeenCalledWith("E:\\q\\README.md");
  });

  it("R3: clicking an image opens it in the editor's existing preview form, not a text editor", async () => {
    (URL as unknown as Record<string, unknown>).createObjectURL = () => "blob:test";
    (URL as unknown as Record<string, unknown>).revokeObjectURL = () => {};
    h.ex.list.mockImplementation(async (path: string) =>
      path === "E:\\q" ? listing(path, [file("E:\\q\\photo.png")]) : listing(path),
    );
    h.ed.readBytes.mockResolvedValue(new Uint8Array([137, 80, 78, 71]));
    h.ed.open.mockResolvedValue(doc("E:\\q\\photo.png"));
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openApp();
    const files = await showFiles();

    await userEvent.click(within(files).getByTitle("E:\\q\\photo.png"));

    expect(await screen.findByRole("button", { name: "Open…" })).toBeInTheDocument();
    expect(await screen.findByAltText("Preview of photo.png")).toBeInTheDocument();
    expect(screen.queryByTestId("surface")).toBeNull();
    expect(h.ed.open).toHaveBeenCalledWith("E:\\q\\photo.png");
    expect(h.ed.readBytes).toHaveBeenCalledWith("E:\\q\\photo.png");
  });

  it("R3: clicking a file that is already open focuses its tab instead of opening a second", async () => {
    h.ed.list.mockResolvedValue({ open: [entry("E:\\q\\README.md")], bin: [] });
    h.ex.list.mockImplementation(async (path: string) =>
      path === "E:\\q" ? listing(path, [file("E:\\q\\README.md")]) : listing(path),
    );
    h.ed.open.mockResolvedValue(doc("E:\\q\\README.md"));
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openApp();
    const files = await showFiles();

    const before = (await screen.findAllByRole("tab")).length;
    await userEvent.click(within(files).getByTitle("E:\\q\\README.md"));

    const editors = await screen.findByRole("tablist", { name: "Open editors" });
    expect(await within(editors).findByRole("tab", { name: /README\.md/ })).toBeInTheDocument();
    expect(within(editors).getAllByRole("tab")).toHaveLength(1);
    expect(h.ed.open).toHaveBeenCalledWith("E:\\q\\README.md");
    expect(before).toBeGreaterThan(0);
  });

  it("R3: a file that fails to open shows the editor's existing error instead of crashing", async () => {
    h.ed.list.mockResolvedValue({ open: [entry("E:\\q\\keep.txt")], bin: [] });
    h.ex.list.mockImplementation(async (path: string) =>
      path === "E:\\q" ? listing(path, [file("E:\\q\\gone.txt")]) : listing(path),
    );
    h.ed.open.mockRejectedValue(new Error("The file was not found: E:\\q\\gone.txt"));
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openEditor();
    const files = await showFiles();

    await userEvent.click(within(files).getByTitle("E:\\q\\gone.txt"));

    expect(await screen.findByRole("alert")).toHaveTextContent("not found");
    expect(screen.getByRole("region", { name: "Files" })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Open editors" })).toBeInTheDocument();
  });

  it("R3: clicking a folder expands it and never opens it as a file", async () => {
    h.ex.list.mockImplementation(async (path: string) =>
      path === "E:\\q" ? listing(path, [folder("E:\\q\\src")]) : listing(path, [file(`${path}\\a.ts`)]),
    );
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openApp();
    const files = await showFiles();

    await userEvent.click(within(files).getByTitle("E:\\q\\src"));

    await waitFor(() => expect(h.ex.list).toHaveBeenCalledWith("E:\\q\\src", false));
    expect(h.ed.open).not.toHaveBeenCalled();
    expect(screen.queryByRole("tablist", { name: "Open editors" })).toBeNull();
  });

  it("R2: a file row stays memoised, so an unrelated App update does not re-render every file", async () => {
    h.ex.list.mockImplementation(async (path: string) =>
      path === "E:\\q" ? listing(path, [file("E:\\q\\README.md")]) : listing(path),
    );
    const kind = vi.mocked(detectKind);
    const reads = () => kind.mock.calls.filter(([name]) => name === "README.md").length;
    kind.mockClear();
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openApp();
    await showFiles();
    await screen.findByTitle("E:\\q\\README.md");
    const before = reads();
    expect(before).toBeGreaterThan(0);

    // Opening the palette is an App state change that leaves the explorer untouched.
    await openPalette();

    expect(reads()).toBe(before);
  });
});

describe("the explorer root follows the user", () => {
  it("R4: in the app view it is the selected app's root and follows a newly selected app", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openApp();

    await showFiles();
    await waitFor(() => expect(h.ex.list).toHaveBeenCalledWith("E:\\q", false));

    // Choosing another app happens in Projects and leaves the Files tab as it was (R4).
    await userEvent.click(screen.getByRole("tab", { name: "Projects" }));
    await userEvent.click(screen.getByTitle("E:\\p"));
    await waitFor(() => expect(h.ex.list).toHaveBeenCalledWith("E:\\p", false));
    expect(screen.getByRole("tab", { name: "Projects" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tablist", { name: "Open editors" })).toBeNull();
  });

  it("R4: in the editor view it is the deepest owning app's root", async () => {
    h.view = view({
      apps: [
        { id: "a1", name: "Qonsol", root: "E:\\q", terminals: [T("t1", "api")] },
        { id: "a3", name: "Inner", root: "E:\\q\\inner", terminals: [] },
      ],
    });
    h.ed.list.mockResolvedValue({ open: [entry("E:\\q\\inner\\src\\a.ts")], bin: [] });
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openEditor();
    await showFiles();

    await waitFor(() => expect(h.ex.list).toHaveBeenCalledWith("E:\\q\\inner", false));
  });

  it("R4: opening a file under the current root keeps the same owning app, so the root does not jump", async () => {
    h.ex.list.mockImplementation(async (path: string) =>
      path === "E:\\q" ? listing(path, [file("E:\\q\\README.md")]) : listing(path),
    );
    h.ed.open.mockResolvedValue(doc("E:\\q\\README.md"));
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openApp();
    const files = await showFiles();

    await userEvent.click(within(files).getByTitle("E:\\q\\README.md"));
    await screen.findByRole("tab", { name: /README\.md/ });

    const roots = h.ex.list.mock.calls.map((c) => c[0]);
    expect(new Set(roots)).toEqual(new Set(["E:\\q"]));
  });

  it("R4: an app root that no longer exists shows as unreadable instead of raising", async () => {
    h.ex.list.mockImplementation(async (path: string) => {
      if (path === "E:\\q") throw new Error("The system cannot find the path specified.");
      return listing(path);
    });
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openApp();

    const files = await showFiles();
    await waitFor(() => expect(within(files).getByText(/can.t be read/)).toBeInTheDocument());
    expect(await screen.findByRole("heading", { name: "Qonsol", level: 2 })).toBeInTheDocument();
  });
});

describe("a Misc (app-less) tab", () => {
  it("R5: an app-owned active tab roots at the app root, and switching to a Misc tab roots at that file's parent", async () => {
    h.ed.list.mockResolvedValue({ open: [entry("E:\\q\\src\\a.ts"), entry("C:\\loose\\notes.txt")], bin: [] });
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openEditor();
    await showFiles();

    await waitFor(() => expect(h.ex.list).toHaveBeenCalledWith("E:\\q", false));
    const tabs = await screen.findAllByRole("tab");

    await userEvent.click(screen.getByRole("tab", { name: /notes\.txt/ }));
    await waitFor(() => expect(h.ex.list).toHaveBeenCalledWith("C:\\loose", false));
    expect((await screen.findAllByRole("tab")).length).toBe(tabs.length);
  });

  it("R5: a Misc file in a deep path roots at its parent folder, not the home folder", async () => {
    h.ed.list.mockResolvedValue({ open: [entry("C:\\Users\\me\\work\\loose\\notes.txt")], bin: [] });
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openEditor();
    await showFiles();

    await waitFor(() => expect(h.ex.list).toHaveBeenCalledWith("C:\\Users\\me\\work\\loose", false));
    const roots = h.ex.list.mock.calls.map((c) => c[0]);
    expect(roots).not.toContain("C:\\Users\\me");
  });

  it("R5: a Misc file at a drive root roots at the drive and Up reaches the drive list", async () => {
    h.ed.list.mockResolvedValue({ open: [entry("D:\\file.txt")], bin: [] });
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openEditor();
    await showFiles();

    await waitFor(() => expect(h.ex.list).toHaveBeenCalledWith("D:\\", false));
    await userEvent.click(await screen.findByRole("button", { name: "Up" }));

    await waitFor(() => expect(h.ex.drives).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: /C:/ })).toBeInTheDocument();
  });
});

describe("the Files section with no apps", () => {
  it("R9: a loose file still gets the sidebar and its Files section", async () => {
    h.view = view({ apps: [] });
    h.ed.takePending.mockResolvedValue(["C:/loose/notes.txt"]);
    h.ed.open.mockResolvedValue(doc("C:/loose/notes.txt"));
    render(<App />);

    expect(await screen.findByRole("navigation", { name: "Apps" })).toBeInTheDocument();
    const files = await showFiles();
    expect(files).toBeInTheDocument();
    await waitFor(() => expect(h.ex.list).toHaveBeenCalledWith("C:\\loose", false));
    expect(screen.queryByRole("button", { name: /Home/ })).toBeNull();
  });
});

describe("the home folder root (R13)", () => {
  it("R13: the home view roots the explorer at the user's home folder", async () => {
    h.ex.home.mockResolvedValue("C:\\Users\\me");
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });

    const files = await showFiles();
    await waitFor(() => expect(h.ex.list).toHaveBeenCalledWith("C:\\Users\\me", false));
    expect(files).toBeInTheDocument();
  });

  it("R13: the editor view with no tab open roots at the home folder", async () => {
    h.ex.home.mockResolvedValue("C:\\Users\\me");
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openEditor();
    await showFiles();

    await waitFor(() => expect(h.ex.list).toHaveBeenCalledWith("C:\\Users\\me", false));
  });

  it("R13: switching back to the home view keeps every open editor tab", async () => {
    h.ex.home.mockResolvedValue("C:\\Users\\me");
    h.ed.list.mockResolvedValue({ open: [entry("E:\\q\\README.md")], bin: [] });
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openEditor();
    await showFiles();
    expect(await screen.findByRole("tab", { name: /README\.md/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Projects" }));
    await userEvent.click(screen.getByRole("button", { name: /Home/ }));
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await waitFor(() => expect(h.ex.list).toHaveBeenCalledWith("C:\\Users\\me", false));
    expect(h.ed.close).not.toHaveBeenCalled();

    await openEditor();
    expect(await screen.findByRole("tab", { name: /README\.md/ })).toBeInTheDocument();
  });

  it("R13: switching from an app-owned tab to a misc file roots at its parent, and Up still reaches the drive list", async () => {
    h.ex.home.mockResolvedValue("C:\\Users\\me");
    h.ed.list.mockResolvedValue({ open: [entry("E:\\q\\src\\a.ts"), entry("C:\\loose\\notes.txt")], bin: [] });
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openEditor();
    await showFiles();

    await waitFor(() => expect(h.ex.list).toHaveBeenCalledWith("E:\\q", false));
    await userEvent.click(await screen.findByRole("tab", { name: /notes\.txt/ }));
    await waitFor(() => expect(h.ex.list).toHaveBeenCalledWith("C:\\loose", false));

    await userEvent.click(screen.getByRole("button", { name: "Up" }));
    await waitFor(() => expect(h.ex.list).toHaveBeenCalledWith("C:\\", false));
    await userEvent.click(screen.getByRole("button", { name: "Up" }));
    await waitFor(() => expect(h.ex.drives).toHaveBeenCalled());
  });

  it("R13: an unreadable home folder shows as locked and the rest of the app stays usable", async () => {
    h.ex.home.mockResolvedValue("C:\\Users\\me");
    h.ex.list.mockImplementation(async (path: string) => {
      if (path === "C:\\Users\\me") throw new Error("Access denied");
      return listing(path);
    });
    render(<App />);

    const files = await showFiles();
    await waitFor(() => expect(within(files).getByText(/can.t be read/)).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Home", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Apps" })).toBeInTheDocument();
  });
});

describe("the explorer's file operations keep the editor tabs in step (R9)", () => {
  const files = () => screen.findByRole("region", { name: "Files" });

  it("R9: renaming an open file from the explorer re-points its tab to the new path", async () => {
    h.ex.list.mockImplementation(async (path: string) =>
      path === "E:\\q" ? listing(path, [file("E:\\q\\a.txt"), folder("E:\\q\\lib")]) : listing(path),
    );
    h.ed.open.mockResolvedValue(doc("E:\\q\\a.txt"));
    h.ex.rename.mockResolvedValue({
      path: "E:\\q\\b.txt",
      repaths: [{ id: "E:\\q\\a.txt", path: "E:\\q\\b.txt", title: "b.txt" }],
      closed: [],
    });
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openApp();
    await showFiles();

    // Opening the file moves to the editor view, where the explorer's toolbar is available.
    await userEvent.click(within(await files()).getByTitle("E:\\q\\a.txt"));
    expect(await screen.findByRole("tab", { name: /a\.txt/ })).toBeInTheDocument();

    // Select the row (the file is already open, so this only focuses its tab), then rename it.
    await userEvent.click(within(await files()).getByTitle("E:\\q\\a.txt"));
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    const dialog = await screen.findByRole("dialog", { name: "Rename" });
    const input = within(dialog).getByLabelText("Name");
    await userEvent.clear(input);
    await userEvent.type(input, "b.txt");
    await userEvent.click(within(dialog).getByRole("button", { name: "Rename" }));

    await waitFor(() => expect(h.ex.rename).toHaveBeenCalledWith("E:\\q\\a.txt", "b.txt"));
    expect(await screen.findByRole("tab", { name: /b\.txt/ })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /a\.txt/ })).toBeNull();
  });

  it("R9: deleting an open file from the explorer closes its tab after one confirmation", async () => {
    h.ex.list.mockImplementation(async (path: string) =>
      path === "E:\\q" ? listing(path, [file("E:\\q\\a.txt")]) : listing(path),
    );
    h.ed.open.mockResolvedValue(doc("E:\\q\\a.txt"));
    h.ex.remove.mockResolvedValue({ path: "E:\\q\\a.txt", repaths: [], closed: ["E:\\q\\a.txt"] });
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openApp();
    await showFiles();

    await userEvent.click(within(await files()).getByTitle("E:\\q\\a.txt"));
    expect(await screen.findByRole("tab", { name: /a\.txt/ })).toBeInTheDocument();

    await userEvent.click(within(await files()).getByTitle("E:\\q\\a.txt"));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete a.txt?" });
    expect(within(dialog).getByText(/Recycle Bin/)).toBeInTheDocument();
    expect(h.ex.remove).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(h.ex.remove).toHaveBeenCalledWith("E:\\q\\a.txt"));
    await waitFor(() => expect(screen.queryByRole("tab", { name: /a\.txt/ })).toBeNull());
    // Re-pointing and closing editor tabs never switches the sidebar tab by itself (R4).
    expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("the Files tab is loaded on first use (A1)", () => {
  it("A1: starting on Projects reads no folder, Files lists once, and coming back keeps it", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openApp();
    expect(h.ex.list).not.toHaveBeenCalled();

    await showFiles();
    await waitFor(() => expect(h.ex.list).toHaveBeenCalledWith("E:\\q", false));
    expect(h.ex.list).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("tab", { name: "Projects" }));
    await userEvent.click(screen.getByRole("tab", { name: "Files" }));
    expect(screen.getByRole("region", { name: "Files" })).toBeInTheDocument();
    expect(h.ex.list).toHaveBeenCalledTimes(1);
  });
});

describe("the Projects | Files sidebar tabs in the whole window", () => {
  const filesPanel = () => screen.findByRole("region", { name: "Files" });

  it("R1: the expanded sidebar still lists the Home row, every app and terminal with a roll-up dot", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });

    const nav = within(screen.getByRole("navigation", { name: "Apps" }));
    expect(nav.getByRole("button", { name: /Home/ })).toBeInTheDocument();
    expect(nav.getByText("Qonsol")).toBeInTheDocument();
    expect(nav.getByText("pdfer")).toBeInTheDocument();
    expect(nav.getByText("api")).toBeInTheDocument();
    expect(nav.getAllByRole("img", { name: "App status: grey" })).toHaveLength(2);
  });

  it("R1: the collapsed rail still keeps Expand, Home and the app initials with their dots", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await userEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    const rail = within(screen.getByRole("navigation", { name: "Apps (collapsed)" }));
    expect(rail.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    expect(rail.getByRole("button", { name: "Home" })).toBeInTheDocument();
    expect(rail.getByRole("button", { name: "Open Qonsol" })).toHaveTextContent("Q");
    expect(rail.getByRole("button", { name: "Open pdfer" })).toHaveTextContent("P");
    expect(rail.getAllByRole("img", { name: "App status: grey" })).toHaveLength(2);
  });

  it("R1: it opens on Projects showing the Home row and apps, and Files shows only the explorer", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });

    expect(screen.getAllByRole("tab", { name: /^(Projects|Files)$/ })).toHaveLength(2);
    expect(screen.getByRole("tab", { name: "Projects" })).toHaveAttribute("aria-selected", "true");
    const nav = within(screen.getByRole("navigation", { name: "Apps" }));
    expect(nav.getByRole("button", { name: /Home/ })).toBeInTheDocument();
    expect(nav.getByText("Qonsol")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Files" })).toBeNull();

    const files = await showFiles();
    expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Files" })).toContainElement(files);
    expect(screen.queryByRole("button", { name: /Home/ })).toBeNull();
    expect(nav.queryByRole("button", { name: /Qonsol/ })).toBeNull();
    expect(nav.queryByRole("button", { name: /api/ })).toBeNull();
  });

  it("R1: with no apps but a folder to show, both tabs are there and Files shows the explorer", async () => {
    h.view = view({ apps: [] });
    h.ex.home.mockResolvedValue("C:\\Users\\me");
    render(<App />);
    await screen.findByText(/No apps yet/);

    expect(screen.getByRole("navigation", { name: "Apps" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Projects" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Files" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Home/ })).toBeNull();

    const files = await showFiles();
    expect(files).toBeInTheDocument();
    await waitFor(() => expect(h.ex.list).toHaveBeenCalledWith("C:\\Users\\me", false));
  });

  it("R1: with no apps and no folder to root at, the sidebar stays hidden as it is today", async () => {
    h.view = view({ apps: [] });
    h.ex.home.mockResolvedValue(null);
    render(<App />);
    await screen.findByText(/No apps yet/);

    expect(screen.queryByRole("navigation", { name: "Apps" })).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(h.ex.list).not.toHaveBeenCalled();
  });

  it("R1: switching tabs leaves the selected app and its terminals alone", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openApp();
    await showFiles();
    await userEvent.click(screen.getByRole("tab", { name: "Projects" }));

    expect(await screen.findByRole("heading", { name: "Qonsol", level: 2 })).toBeInTheDocument();
    expect(h.api.startTerminal).not.toHaveBeenCalled();
    expect(h.api.stopTerminal).not.toHaveBeenCalled();
    expect(h.api.restartTerminal).not.toHaveBeenCalled();
    expect(h.ed.open).not.toHaveBeenCalled();
  });

  it("R1: switching tabs never changes the active editor file, its tab or its text", async () => {
    h.ex.list.mockImplementation(async (path: string) =>
      path === "E:\\q" ? listing(path, [file("E:\\q\\README.md")]) : listing(path),
    );
    h.ed.open.mockResolvedValue(doc("E:\\q\\README.md", "# readme"));
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openApp();
    const files = await showFiles();
    await userEvent.click(within(files).getByTitle("E:\\q\\README.md"));

    const openTab = await screen.findByRole("tab", { name: /README\.md/ });
    expect(openTab).toHaveAttribute("aria-selected", "true");
    expect(h.ed.open).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("tab", { name: "Projects" }));
    await userEvent.click(screen.getByRole("tab", { name: "Files" }));

    expect(screen.getByRole("tab", { name: /README\.md/ })).toHaveAttribute("aria-selected", "true");
    expect(h.ed.open).toHaveBeenCalledTimes(1);
    expect(h.ed.close).not.toHaveBeenCalled();
    expect(await screen.findByTestId("surface")).toHaveValue("# readme");
  });

  it("R3: the rail Files and Projects icons expand the pane straight onto their tab", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await userEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(screen.getByRole("navigation", { name: "Apps (collapsed)" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Files" }));
    expect(screen.getByRole("navigation", { name: "Apps" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-selected", "true");
    expect(await filesPanel()).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    await userEvent.click(screen.getByRole("button", { name: "Projects" }));
    expect(screen.getByRole("tab", { name: "Projects" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: /Home/ })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Files" })).toBeNull();
  });

  it("R3: clicking Home or an app initial in the rail keeps today's behaviour and leaves the tab alone", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await showFiles();
    await userEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    const rail = within(screen.getByRole("navigation", { name: "Apps (collapsed)" }));
    await userEvent.click(rail.getByRole("button", { name: "Open Qonsol" }));
    expect(await screen.findByRole("heading", { name: "Qonsol", level: 2 })).toBeInTheDocument();
    await userEvent.click(rail.getByRole("button", { name: "Home" }));
    expect(await screen.findByRole("heading", { name: "Home", level: 2 })).toBeInTheDocument();

    await userEvent.click(rail.getByRole("button", { name: "Expand sidebar" }));
    expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-selected", "true");
  });

  it("R4: choosing Home from the palette does not switch the sidebar tab", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openApp();
    await showFiles();

    const dialog = await openPalette();
    await userEvent.click(within(dialog).getByRole("button", { name: /Go to Home/ }));
    expect(await screen.findByRole("heading", { name: "Home", level: 2 })).toBeInTheDocument();

    expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("region", { name: "Files" })).toBeInTheDocument();
  });

  it("R4: selecting an app from the Home screen leaves the sidebar tab alone", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await showFiles();

    await openApp();
    expect(await screen.findByRole("heading", { name: "Qonsol", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("region", { name: "Files" })).toBeInTheDocument();
  });

  it("R4: a delete that closes an editor tab keeps the sidebar on Files", async () => {
    h.ex.list.mockImplementation(async (path: string) =>
      path === "E:\\q" ? listing(path, [file("E:\\q\\a.txt")]) : listing(path),
    );
    h.ed.open.mockResolvedValue(doc("E:\\q\\a.txt"));
    h.ex.remove.mockResolvedValue({ path: "E:\\q\\a.txt", repaths: [], closed: ["E:\\q\\a.txt"] });
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openApp();
    const files = await showFiles();

    await userEvent.click(within(files).getByTitle("E:\\q\\a.txt"));
    expect(await screen.findByRole("tab", { name: /a\.txt/ })).toBeInTheDocument();

    await userEvent.click(within(await filesPanel()).getByTitle("E:\\q\\a.txt"));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete a.txt?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(h.ex.remove).toHaveBeenCalledWith("E:\\q\\a.txt"));
    await waitFor(() => expect(screen.queryByRole("tab", { name: /a\.txt/ })).toBeNull());
    expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("the Files header context in the whole window (R6)", () => {
  it("R6: an app root shows the app's name and the folder name", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openApp();
    const files = await showFiles();
    await waitFor(() => expect(h.ex.list).toHaveBeenCalledWith("E:\\q", false));

    expect(within(files).getByText("Qonsol")).toBeInTheDocument();
    expect(within(files).getByText("q")).toBeInTheDocument();
  });

  it("R6: a loose file's folder shows Misc and the folder name", async () => {
    h.ed.list.mockResolvedValue({ open: [entry("C:\\loose\\notes.txt")], bin: [] });
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openEditor();
    const files = await showFiles();
    await waitFor(() => expect(h.ex.list).toHaveBeenCalledWith("C:\\loose", false));

    expect(within(files).getByText("Misc")).toBeInTheDocument();
    expect(within(files).getByText("loose")).toBeInTheDocument();
  });

  it("R6: the home folder shows Home and the folder name", async () => {
    h.ex.home.mockResolvedValue("C:\\Users\\me");
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    const files = await showFiles();
    await waitFor(() => expect(h.ex.list).toHaveBeenCalledWith("C:\\Users\\me", false));

    expect(within(files).getByText("Home")).toBeInTheDocument();
    expect(within(files).getByText("me")).toBeInTheDocument();
  });
});

describe("the Files tab keeps its place across a tab switch (R10)", () => {
  it("R10: the same folder stays expanded, the root is unchanged and nothing is listed twice", async () => {
    h.ex.list.mockImplementation(async (path: string) =>
      path === "E:\\q" ? listing(path, [folder("E:\\q\\src")]) : listing(path, [file(`${path}\\a.ts`)]),
    );
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openApp();
    const files = await showFiles();
    await userEvent.click(within(files).getByTitle("E:\\q\\src"));
    await waitFor(() => expect(h.ex.list).toHaveBeenCalledWith("E:\\q\\src", false));
    const calls = h.ex.list.mock.calls.length;

    await userEvent.click(screen.getByRole("tab", { name: "Projects" }));
    await userEvent.click(screen.getByRole("tab", { name: "Files" }));

    const back = screen.getByRole("region", { name: "Files" });
    expect(within(back).getByTitle("E:\\q\\src")).toHaveAttribute("aria-expanded", "true");
    expect(within(back).getByText("a.ts")).toBeInTheDocument();
    expect(h.ex.list.mock.calls.length).toBe(calls);
    expect(new Set(h.ex.list.mock.calls.map((c) => c[0]))).toEqual(new Set(["E:\\q", "E:\\q\\src"]));
  });

  it("R10: a change that genuinely re-roots the explorer still resets it", async () => {
    h.ex.list.mockImplementation(async (path: string) => listing(path, []));
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openApp();
    await showFiles();
    await waitFor(() => expect(h.ex.list).toHaveBeenCalledWith("E:\\q", false));

    await userEvent.click(screen.getByRole("tab", { name: "Projects" }));
    await userEvent.click(screen.getByTitle("E:\\p"));
    await waitFor(() => expect(h.ex.list).toHaveBeenCalledWith("E:\\p", false));

    await userEvent.click(screen.getByRole("tab", { name: "Files" }));
    const roots = h.ex.list.mock.calls.map((c) => c[0]);
    expect(roots).toContain("E:\\p");
    expect(new Set(roots)).not.toContain("E:\\q\\src");
  });
});

describe("the sidebar tab is kept for the session (R8)", () => {
  it("R8: it starts on Projects and shows Files again after collapsing and expanding", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    expect(screen.getByRole("tab", { name: "Projects" })).toHaveAttribute("aria-selected", "true");

    await showFiles();
    await userEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(screen.getByRole("navigation", { name: "Apps (collapsed)" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-selected", "true");

    // Ctrl+B collapses and expands too, and the chosen tab still survives both directions.
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(screen.getByRole("navigation", { name: "Apps (collapsed)" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("region", { name: "Files" })).toBeInTheDocument();
  });

  it("R8: a reload starts on Projects again and no tab value is saved", async () => {
    const first = render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await showFiles();
    expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-selected", "true");
    expect(Object.keys(localStorage)).not.toContain("td.sidebarTab");
    first.unmount();

    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    expect(screen.getByRole("tab", { name: "Projects" })).toHaveAttribute("aria-selected", "true");
    expect(Object.keys(localStorage)).not.toContain("td.sidebarTab");
  });

  it("R8: with storage throwing, startup and tab switching still work and no tab value is written", async () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage denied");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage denied");
    });
    try {
      render(<App />);
      await screen.findByRole("heading", { name: "Home", level: 2 });
      expect(screen.getByRole("navigation", { name: "Apps" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Projects" })).toHaveAttribute("aria-selected", "true");

      await userEvent.click(screen.getByRole("tab", { name: "Files" }));
      expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("region", { name: "Files" })).toBeInTheDocument();
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });

  it("R8: choosing a file, an app or Home leaves the session tab on Files", async () => {
    h.ex.list.mockImplementation(async (path: string) =>
      path === "E:\\q" ? listing(path, [file("E:\\q\\README.md")]) : listing(path),
    );
    h.ed.open.mockResolvedValue(doc("E:\\q\\README.md"));
    render(<App />);
    await screen.findByRole("heading", { name: "Home", level: 2 });
    await openApp();
    const files = await showFiles();

    // A file opened from Files keeps the tab.
    await userEvent.click(within(files).getByTitle("E:\\q\\README.md"));
    await screen.findByRole("tab", { name: /README\.md/ });
    expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-selected", "true");

    // Selecting an app from the rail and then Home still leaves Files selected.
    await userEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    await userEvent.click(screen.getByRole("button", { name: "Open pdfer" }));
    await userEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-selected", "true");

    await userEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    await userEvent.click(screen.getByRole("button", { name: "Home" }));
    await userEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-selected", "true");
  });
});

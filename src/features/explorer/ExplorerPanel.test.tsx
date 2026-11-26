import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExplorerEntry, ExplorerListing, ExplorerOp } from "../../api/explorer";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  drives: vi.fn(),
  create: vi.fn(),
  rename: vi.fn(),
  move: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("../../api/explorer", () => ({ explorerApi: api }));

const tauri = vi.hoisted(() => ({
  pickFolder: vi.fn(),
  errorText: (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : String(e)),
}));
vi.mock("../../api/tauri", () => tauri);

const ed = vi.hoisted(() => ({
  list: vi.fn(),
  open: vi.fn(),
  newDoc: vi.fn(),
  load: vi.fn(),
  snapshot: vi.fn(),
  save: vi.fn(),
  close: vi.fn(),
  restore: vi.fn(),
  discard: vi.fn(),
  takePending: vi.fn(),
  touch: vi.fn(),
  pickOpenPaths: vi.fn(),
  pickSavePath: vi.fn(),
  onOpen: vi.fn(),
}));
vi.mock("../../api/editor", () => ({ editorApi: ed }));

import { ExplorerPanel } from "./ExplorerPanel";
import { useEditor } from "../../state/useEditor";
import type { ExplorerEditorBridge } from "./useExplorerOps";

const ROOT = "C:\\proj";
const file = (name: string, dir = ROOT): ExplorerEntry => ({ name, path: `${dir}\\${name}`, isDir: false, locked: false });
const folder = (name: string, dir = ROOT, locked = false): ExplorerEntry => ({
  name,
  path: `${dir}\\${name}`,
  isDir: true,
  locked,
});
const listing = (path: string, entries: ExplorerEntry[] = [], extra: Partial<ExplorerListing> = {}): ExplorerListing => ({
  path,
  entries,
  total: extra.total ?? entries.length,
  truncated: extra.truncated ?? false,
  locked: extra.locked ?? false,
});

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

const renderPanel = (props: Partial<Parameters<typeof ExplorerPanel>[0]> = {}) => {
  const onOpenFile = vi.fn();
  const view = render(<ExplorerPanel root={ROOT} source="app" onOpenFile={onOpenFile} {...props} />);
  return { onOpenFile, ...view };
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  tauri.pickFolder.mockReset();
  tauri.pickFolder.mockResolvedValue(null);
  api.list.mockImplementation(async (path: string) => listing(path));
  api.drives.mockResolvedValue([
    { name: "C:", path: "C:\\", isDir: true, locked: false },
    { name: "D:", path: "D:\\", isDir: true, locked: false },
  ]);
  for (const fn of Object.values(ed)) fn.mockReset();
  ed.list.mockResolvedValue({ open: [], bin: [] });
  ed.takePending.mockResolvedValue([]);
  ed.onOpen.mockResolvedValue(() => {});
});

describe("ExplorerPanel", () => {
  it("R2 lists one level and distinguishes folders from files", async () => {
    api.list.mockResolvedValue(listing(ROOT, [folder("src"), file("README.md")]));
    renderPanel();
    await flush();

    const dir = screen.getByTitle("C:\\proj\\src");
    expect(dir).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTitle("C:\\proj\\README.md")).not.toHaveAttribute("aria-expanded");
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it("R2 clicking a folder expands it, fetching its children only then, and clicking again collapses it", async () => {
    api.list.mockImplementation(async (path: string) =>
      path === ROOT ? listing(ROOT, [folder("src")]) : listing(path, [file("a.ts", path)]),
    );
    renderPanel();
    await flush();
    expect(api.list.mock.calls.filter((c) => c[0] === "C:\\proj\\src")).toHaveLength(0);

    await userEvent.click(screen.getByTitle("C:\\proj\\src"));
    await flush();
    expect(api.list).toHaveBeenCalledWith("C:\\proj\\src", false);
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    expect(screen.getByTitle("C:\\proj\\src")).toHaveAttribute("aria-expanded", "true");

    await userEvent.click(screen.getByTitle("C:\\proj\\src"));
    expect(screen.queryByText("a.ts")).toBeNull();
    expect(screen.getByTitle("C:\\proj\\src")).toHaveAttribute("aria-expanded", "false");
  });

  it("R2 an empty folder expands without error and shows no children", async () => {
    api.list.mockImplementation(async (path: string) =>
      path === ROOT ? listing(ROOT, [folder("empty")]) : listing(path, []),
    );
    renderPanel();
    await flush();

    await userEvent.click(screen.getByTitle("C:\\proj\\empty"));
    await flush();
    expect(screen.getByText("Empty folder")).toBeInTheDocument();
    expect(screen.queryByRole("listitem", { name: /No such/ })).toBeNull();
  });

  it("R2 a large folder shows a loading indication while it reads", async () => {
    let release: (value: ExplorerListing) => void = () => {};
    const pending = new Promise<ExplorerListing>((resolve) => {
      release = resolve;
    });
    api.list.mockImplementation(async (path: string) => (path === ROOT ? listing(ROOT, [folder("many")]) : pending));
    renderPanel();
    await flush();

    await userEvent.click(screen.getByTitle("C:\\proj\\many"));
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");

    await act(async () => {
      release(listing("C:\\proj\\many", [file("one.txt", "C:\\proj\\many")]));
      await pending;
    });
    expect(screen.getByText("one.txt")).toBeInTheDocument();
  });

  it("R2 a folder that cannot be read shows as locked instead of throwing", async () => {
    api.list.mockImplementation(async (path: string) => {
      if (path === "C:\\proj\\secret") throw new Error("Access denied");
      return listing(ROOT, [folder("secret", ROOT, true)]);
    });
    renderPanel();
    await flush();
    expect(screen.getByLabelText("Locked folder")).toBeInTheDocument();

    await userEvent.click(screen.getByTitle("C:\\proj\\secret"));
    await flush();
    expect(screen.getByText(/This folder can't be read\./)).toBeInTheDocument();
  });

  it("R2 other dot-named files and folders are listed normally", async () => {
    api.list.mockResolvedValue(listing(ROOT, [file(".env"), file(".gitignore"), folder(".vscode")]));
    renderPanel();
    await flush();
    expect(screen.getByText(".env")).toBeInTheDocument();
    expect(screen.getByText(".gitignore")).toBeInTheDocument();
    expect(screen.getByText(".vscode")).toBeInTheDocument();
  });

  it("R2 Show hidden turns the hidden names on and off again", async () => {
    api.list.mockResolvedValue(listing(ROOT, []));
    renderPanel();
    await flush();

    await userEvent.click(screen.getByRole("button", { name: "Show hidden" }));
    await flush();
    expect(screen.getByRole("button", { name: "Hide hidden" })).toHaveAttribute("aria-pressed", "true");
    expect(api.list).toHaveBeenCalledWith(ROOT, true);

    await userEvent.click(screen.getByRole("button", { name: "Hide hidden" }));
    await flush();
    expect(screen.getByRole("button", { name: "Show hidden" })).toHaveAttribute("aria-pressed", "false");
    expect(api.list).toHaveBeenLastCalledWith(ROOT, false);
  });

  it("R3 clicking a file hands it to the editor's existing open path and never reads it as a folder", async () => {
    api.list.mockImplementation(async (path: string) =>
      path === ROOT ? listing(ROOT, [folder("src"), file("README.md")]) : listing(path, []),
    );
    const { onOpenFile } = renderPanel();
    await flush();

    await userEvent.click(screen.getByTitle("C:\\proj\\README.md"));
    expect(onOpenFile).toHaveBeenCalledWith("C:\\proj\\README.md");
    expect(api.list.mock.calls.some((c) => c[0] === "C:\\proj\\README.md")).toBe(false);
  });

  it("R3 a file that is already open still goes through the same single open path", async () => {
    api.list.mockResolvedValue(listing(ROOT, [file("README.md")]));
    const { onOpenFile } = renderPanel();
    await flush();

    await userEvent.click(screen.getByTitle("C:\\proj\\README.md"));
    await userEvent.click(screen.getByTitle("C:\\proj\\README.md"));
    expect(onOpenFile).toHaveBeenCalledTimes(2);
    expect(onOpenFile).toHaveBeenNthCalledWith(1, "C:\\proj\\README.md");
    expect(onOpenFile).toHaveBeenNthCalledWith(2, "C:\\proj\\README.md");
  });

  it("R3 clicking a folder only expands it and never opens it as a file", async () => {
    api.list.mockImplementation(async (path: string) =>
      path === ROOT ? listing(ROOT, [folder("src")]) : listing(path, [file("a.ts", path)]),
    );
    const { onOpenFile } = renderPanel();
    await flush();

    await userEvent.click(screen.getByTitle("C:\\proj\\src"));
    await flush();
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("R3 a click reaches the editor controller's openPath, the same editor_open_any the picker uses", async () => {
    api.list.mockResolvedValue(listing(ROOT, [file("README.md")]));
    ed.open.mockImplementation(async (path: string) => ({
      id: "d1",
      path,
      title: "README.md",
      content: "text",
      dirty: false,
      eol: "lf",
      encoding: "utf-8",
    }));

    function Harness() {
      const editor = useEditor();
      return <ExplorerPanel root={ROOT} source="app" onOpenFile={(path) => void editor.openPath(path)} />;
    }
    render(<Harness />);
    await flush();
    await userEvent.click(screen.getByTitle("C:\\proj\\README.md"));
    await waitFor(() => expect(ed.open).toHaveBeenCalledWith("C:\\proj\\README.md"));
    expect(ed.open).toHaveBeenCalledTimes(1);
    expect(ed.pickOpenPaths).not.toHaveBeenCalled(); // the explorer does not open a second picker
  });

  it("R5 a Misc root offers Up that climbs to the drive list", async () => {
    api.list.mockImplementation(async (path: string) => listing(path, path === "C:\\Users" ? [folder("me")] : []));
    renderPanel({ root: "C:\\Users", source: "misc" });
    await flush();

    await userEvent.click(screen.getByRole("button", { name: "Up" }));
    await flush();
    expect(api.list).toHaveBeenLastCalledWith("C:\\", false);

    await userEvent.click(screen.getByRole("button", { name: "Up" }));
    await flush();
    expect(screen.getByText("C:")).toBeInTheDocument();
    expect(screen.getByText("D:")).toBeInTheDocument();

    await userEvent.click(screen.getByText("C:"));
    await flush();
    expect(api.list).toHaveBeenLastCalledWith("C:\\", false);
  });

  it("R4 an app root offers no Up, so the top folder stays the app root", async () => {
    renderPanel({ root: ROOT, source: "app" });
    await flush();
    expect(screen.queryByRole("button", { name: "Up" })).toBeNull();
  });

  it("R4 switching the selected app or tab changes the root without touching any tab", async () => {
    api.list.mockImplementation(async (path: string) => listing(path, []));
    const { rerender } = render(<ExplorerPanel root={"C:\\a"} source="app" resetKey="app:a" onOpenFile={vi.fn()} />);
    await flush();
    expect(api.list).toHaveBeenLastCalledWith("C:\\a", false);

    rerender(<ExplorerPanel root={"D:\\b"} source="app" resetKey="app:b" onOpenFile={vi.fn()} />);
    await flush();
    expect(api.list).toHaveBeenLastCalledWith("D:\\b", false);
  });

  it("R4 if an app's root no longer exists it shows as locked instead of raising an error", async () => {
    api.list.mockRejectedValue(new Error("The folder does not exist"));
    renderPanel({ root: "C:\\gone", source: "app" });
    await flush();
    expect(screen.getByText(/This folder can't be read\./)).toBeInTheDocument();
  });

  it("R13 a home root shows the home folder and Up climbs one level at a time until the drive list", async () => {
    api.list.mockImplementation(async (path: string) => listing(path, []));
    renderPanel({ root: "C:\\Users\\me", source: "home" });
    await flush();

    expect(api.list).toHaveBeenCalledWith("C:\\Users\\me", false);
    expect(screen.getByRole("button", { name: "Up" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Up" }));
    await flush();
    expect(api.list).toHaveBeenLastCalledWith("C:\\Users", false);

    await userEvent.click(screen.getByRole("button", { name: "Up" }));
    await flush();
    expect(api.list).toHaveBeenLastCalledWith("C:\\", false);

    await userEvent.click(screen.getByRole("button", { name: "Up" }));
    await flush();
    expect(api.drives).toHaveBeenCalled();
    expect(screen.getByText("C:")).toBeInTheDocument();
  });

  it("R13 an unreadable home folder shows the locked state and the panel stays usable", async () => {
    api.list.mockRejectedValue(new Error("Access denied"));
    renderPanel({ root: "C:\\Users\\me", source: "home" });
    await flush();

    expect(screen.getByText(/This folder can't be read\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show hidden" })).toBeInTheDocument();
  });

  it("A1 with no root it shows a hint and asks the core for nothing", async () => {
    const { rerender } = render(<ExplorerPanel root={null} onOpenFile={vi.fn()} />);
    await flush();
    expect(screen.getByText("Open an app or a file to browse its folder.")).toBeInTheDocument();
    expect(api.list).not.toHaveBeenCalled();
    expect(api.drives).not.toHaveBeenCalled();

    api.list.mockResolvedValue(listing(ROOT, [file("README.md")]));
    rerender(<ExplorerPanel root={ROOT} source="app" onOpenFile={vi.fn()} />);
    await flush();
    expect(screen.queryByText("Open an app or a file to browse its folder.")).toBeNull();
    expect(screen.getByText("README.md")).toBeInTheDocument();
  });

  it("A1 says when a level is truncated: Showing first 1000 of 1200", async () => {
    const entries = Array.from({ length: 1000 }, (_, i) => file(`f${i}.txt`));
    api.list.mockResolvedValue(listing(ROOT, entries, { total: 1200, truncated: true }));
    renderPanel();
    await flush();
    expect(screen.getByText("Showing first 1000 of 1200")).toBeInTheDocument();
  });
});

const op = (path: string, extra: Partial<ExplorerOp> = {}): ExplorerOp => ({
  path,
  repaths: [],
  closed: [],
  ...extra,
});

const makeEditor = (): ExplorerEditorBridge => ({
  flushPending: vi.fn().mockResolvedValue(undefined),
  applyRepaths: vi.fn(),
  applyClosed: vi.fn(),
  dirtyTitlesUnder: vi.fn().mockReturnValue([]),
});

function renderOps(editor: ExplorerEditorBridge, onOpenFile = vi.fn()) {
  const view = render(<ExplorerPanel root={ROOT} source="app" onOpenFile={onOpenFile} editor={editor} />);
  return { onOpenFile, ...view };
}

const dialog = () => screen.getByRole("dialog");
const dragData = () => ({ setData: vi.fn(), getData: vi.fn(), effectAllowed: "", dropEffect: "" });

async function openRename(name = "a.txt") {
  await userEvent.click(screen.getByTitle(`C:\\proj\\${name}`));
  await userEvent.click(screen.getByRole("button", { name: "Rename" }));
}

async function openDelete(name = "a.txt") {
  await userEvent.click(screen.getByTitle(`C:\\proj\\${name}`));
  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
}

describe("ExplorerPanel file operations", () => {
  it("R9 creates a new file in the current folder and leaves it unopened in the editor", async () => {
    api.list.mockResolvedValue(listing(ROOT, []));
    api.create.mockResolvedValue("C:\\proj\\new.txt");
    const editor = makeEditor();
    const { onOpenFile } = renderOps(editor);
    await flush();

    await userEvent.click(screen.getByRole("button", { name: "New file" }));
    await userEvent.type(within(dialog()).getByLabelText("Name"), "new.txt");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Create" }));

    await waitFor(() => expect(api.create).toHaveBeenCalledWith(ROOT, "new.txt", "file"));
    // The affected level is read again, and nothing was opened as a tab (R9).
    await waitFor(() => expect(api.list.mock.calls.filter((c) => c[0] === ROOT)).toHaveLength(2));
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("R9 creates a new folder in the current folder", async () => {
    api.list.mockResolvedValue(listing(ROOT, []));
    api.create.mockResolvedValue("C:\\proj\\src");
    renderOps(makeEditor());
    await flush();

    await userEvent.click(screen.getByRole("button", { name: "New folder" }));
    await userEvent.type(within(dialog()).getByLabelText("Name"), "src");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Create" }));

    await waitFor(() => expect(api.create).toHaveBeenCalledWith(ROOT, "src", "folder"));
  });

  it("R9 renames a file and re-points its open tab to the new path", async () => {
    api.list.mockResolvedValue(listing(ROOT, [file("a.txt")]));
    const repaths = [{ id: "d1", path: "C:\\proj\\b.txt", title: "b.txt" }];
    api.rename.mockResolvedValue(op("C:\\proj\\b.txt", { repaths }));
    const editor = makeEditor();
    renderOps(editor);
    await flush();

    await openRename();
    const input = within(dialog()).getByLabelText("Name");
    await userEvent.clear(input);
    await userEvent.type(input, "b.txt");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Rename" }));

    await waitFor(() => expect(api.rename).toHaveBeenCalledWith("C:\\proj\\a.txt", "b.txt"));
    expect(editor.applyRepaths).toHaveBeenCalledWith(repaths);
  });

  it("R9 clears the selection after a rename so the toolbar cannot move a different file now at the old path", async () => {
    let onDisk = [file("a.txt")];
    api.list.mockImplementation(async (path: string) => listing(path, onDisk));
    api.rename.mockImplementation(async () => {
      // After the rename a fresh a.txt sits at the old path (the stale-selection trap).
      onDisk = [file("a.txt"), file("b.txt")];
      return op("C:\\proj\\b.txt");
    });
    tauri.pickFolder.mockResolvedValue("C:\\proj\\lib");
    renderOps(makeEditor());
    await flush();

    await openRename();
    const input = within(dialog()).getByLabelText("Name");
    await userEvent.clear(input);
    await userEvent.type(input, "b.txt");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Rename" }));
    await waitFor(() => expect(api.rename).toHaveBeenCalledWith("C:\\proj\\a.txt", "b.txt"));

    await waitFor(() => expect(screen.getByRole("button", { name: "Move" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(tauri.pickFolder).not.toHaveBeenCalled();
    expect(api.move).not.toHaveBeenCalled();
  });

  it("R9 clears the selection after a delete so the toolbar cannot act on the vanished path", async () => {
    api.list.mockResolvedValue(listing(ROOT, [file("a.txt")]));
    api.remove.mockResolvedValue(op("C:\\proj\\a.txt"));
    renderOps(makeEditor());
    await flush();

    await openDelete();
    await userEvent.click(within(dialog()).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith("C:\\proj\\a.txt"));

    await waitFor(() => expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Move" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });

  it("R9 renames a folder through the same one operation path", async () => {
    api.list.mockImplementation(async (path: string) =>
      path === ROOT ? listing(ROOT, [folder("lib")]) : listing(path, []),
    );
    api.rename.mockResolvedValue(op("C:\\proj\\lib2"));
    renderOps(makeEditor());
    await flush();

    await userEvent.click(screen.getByTitle("C:\\proj\\lib"));
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    const input = within(dialog()).getByLabelText("Name");
    await userEvent.clear(input);
    await userEvent.type(input, "lib2");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Rename" }));

    await waitFor(() => expect(api.rename).toHaveBeenCalledWith("C:\\proj\\lib", "lib2"));
  });

  it("R9 deletes only after confirmation, names the item and sends it to the Recycle Bin", async () => {
    api.list.mockResolvedValue(listing(ROOT, [file("a.txt")]));
    api.remove.mockResolvedValue(op("C:\\proj\\a.txt", { closed: ["d1"] }));
    const editor = makeEditor();
    renderOps(editor);
    await flush();

    await openDelete();
    expect(within(dialog()).getByRole("heading", { name: "Delete a.txt?" })).toBeInTheDocument();
    expect(within(dialog()).getByText(/Recycle Bin/)).toBeInTheDocument();
    expect(api.remove).not.toHaveBeenCalled();

    await userEvent.click(within(dialog()).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith("C:\\proj\\a.txt"));
    expect(editor.flushPending).toHaveBeenCalled();
    expect(editor.applyClosed).toHaveBeenCalledWith(["d1"]);
  });

  it("R9 a folder delete says everything inside goes with it", async () => {
    api.list.mockImplementation(async (path: string) =>
      path === ROOT ? listing(ROOT, [folder("lib")]) : listing(path, []),
    );
    api.remove.mockResolvedValue(op("C:\\proj\\lib"));
    renderOps(makeEditor());
    await flush();

    await userEvent.click(screen.getByTitle("C:\\proj\\lib"));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(within(dialog()).getByText("Everything inside this folder goes with it.")).toBeInTheDocument();
  });

  it("R9 folds an unsaved-changes warning into the one delete prompt", async () => {
    api.list.mockResolvedValue(listing(ROOT, [file("a.txt")]));
    const editor = makeEditor();
    (editor.dirtyTitlesUnder as ReturnType<typeof vi.fn>).mockReturnValue(["a.txt", "notes.md"]);
    renderOps(editor);
    await flush();

    await openDelete();
    expect(within(dialog()).getByText(/unsaved changes/)).toHaveTextContent("a.txt, notes.md");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("R9 cancelling the delete confirmation changes nothing", async () => {
    api.list.mockResolvedValue(listing(ROOT, [file("a.txt")]));
    renderOps(makeEditor());
    await flush();

    await openDelete();
    await userEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(api.remove).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("R9 moves a file to another folder with the explicit Move action and the folder picker", async () => {
    api.list.mockResolvedValue(listing(ROOT, [file("a.txt")]));
    api.move.mockResolvedValue(op("C:\\proj\\lib\\a.txt"));
    tauri.pickFolder.mockResolvedValue("C:\\proj\\lib");
    renderOps(makeEditor());
    await flush();

    await userEvent.click(screen.getByTitle("C:\\proj\\a.txt"));
    await userEvent.click(screen.getByRole("button", { name: "Move" }));
    await waitFor(() => expect(api.move).toHaveBeenCalledWith("C:\\proj\\a.txt", "C:\\proj\\lib"));
  });

  it("R9 drags a file and drops it onto a folder to move it there", async () => {
    api.list.mockImplementation(async (path: string) =>
      path === ROOT ? listing(ROOT, [file("a.txt"), folder("lib")]) : listing(path, []),
    );
    api.move.mockResolvedValue(op("C:\\proj\\lib\\a.txt"));
    renderOps(makeEditor());
    await flush();

    const dataTransfer = dragData();
    fireEvent.dragStart(screen.getByTitle("C:\\proj\\a.txt"), { dataTransfer });
    fireEvent.dragOver(screen.getByTitle("C:\\proj\\lib"), { dataTransfer });
    fireEvent.drop(screen.getByTitle("C:\\proj\\lib"), { dataTransfer });

    await waitFor(() => expect(api.move).toHaveBeenCalledWith("C:\\proj\\a.txt", "C:\\proj\\lib"));
  });

  it("R9 dropping an item onto the folder it is already in changes nothing", async () => {
    api.list.mockImplementation(async (path: string) =>
      path === ROOT ? listing(ROOT, [folder("lib")]) : listing(path, [file("a.txt", path)]),
    );
    renderOps(makeEditor());
    await flush();

    await userEvent.click(screen.getByTitle("C:\\proj\\lib"));
    await flush();
    const dataTransfer = dragData();
    fireEvent.dragStart(screen.getByTitle("C:\\proj\\lib\\a.txt"), { dataTransfer });
    fireEvent.drop(screen.getByTitle("C:\\proj\\lib"), { dataTransfer });

    expect(api.move).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("R9 refuses to drop a folder into one of its own folders before any file-system call", async () => {
    api.list.mockImplementation(async (path: string) =>
      path === ROOT ? listing(ROOT, [folder("lib")]) : listing(path, [folder("sub", path)]),
    );
    renderOps(makeEditor());
    await flush();

    await userEvent.click(screen.getByTitle("C:\\proj\\lib"));
    await flush();
    const dataTransfer = dragData();
    fireEvent.dragStart(screen.getByTitle("C:\\proj\\lib"), { dataTransfer });
    fireEvent.drop(screen.getByTitle("C:\\proj\\lib\\sub"), { dataTransfer });

    expect(api.move).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/moved into itself/);
  });

  it("R9 a name clash reported by the core is shown and the folder is reloaded", async () => {
    api.list.mockResolvedValue(listing(ROOT, []));
    api.create.mockRejectedValue('"new.txt" already exists in this folder.');
    renderOps(makeEditor());
    await flush();

    await userEvent.click(screen.getByRole("button", { name: "New file" }));
    await userEvent.type(within(dialog()).getByLabelText("Name"), "new.txt");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Create" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("already exists"));
    await waitFor(() => expect(api.list.mock.calls.filter((c) => c[0] === ROOT)).toHaveLength(2));
  });

  it("A1 shows a busy state and keeps a second operation from firing while one runs", async () => {
    api.list.mockResolvedValue(listing(ROOT, []));
    let release: (path: string) => void = () => {};
    api.create.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    renderOps(makeEditor());
    await flush();

    await userEvent.click(screen.getByRole("button", { name: "New file" }));
    await userEvent.type(within(dialog()).getByLabelText("Name"), "new.txt");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Create" }));

    expect(screen.getByRole("status")).toHaveTextContent("Working…");
    expect(screen.getByRole("button", { name: "New file" })).toBeDisabled();

    await act(async () => {
      release("C:\\proj\\new.txt");
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
  });

  it("A1 a refused create shows the message and reads the true state again", async () => {
    api.list.mockResolvedValue(listing(ROOT, []));
    api.create.mockRejectedValue("The item could not be created: access denied");
    renderOps(makeEditor());
    await flush();

    await userEvent.click(screen.getByRole("button", { name: "New file" }));
    await userEvent.type(within(dialog()).getByLabelText("Name"), "new.txt");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Create" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("access denied"));
    await waitFor(() => expect(api.list.mock.calls.filter((c) => c[0] === ROOT)).toHaveLength(2));
  });

  it("A2 refuses an empty or whitespace-only name before touching any file", async () => {
    api.list.mockResolvedValue(listing(ROOT, []));
    renderOps(makeEditor());
    await flush();

    await userEvent.click(screen.getByRole("button", { name: "New file" }));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Create" }));
    expect(screen.getByRole("alert")).toHaveTextContent("A name is required.");

    await userEvent.type(within(dialog()).getByLabelText("Name"), "   ");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Create" }));
    expect(screen.getByRole("alert")).toHaveTextContent("A name is required.");
    expect(api.create).not.toHaveBeenCalled();
  });

  it("A2 refuses a Windows-invalid rename name before touching any file", async () => {
    api.list.mockResolvedValue(listing(ROOT, [file("a.txt")]));
    renderOps(makeEditor());
    await flush();

    await openRename();
    const input = within(dialog()).getByLabelText("Name");
    await userEvent.clear(input);
    await userEvent.type(input, "bad:name");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Rename" }));

    expect(screen.getByRole("alert")).toHaveTextContent('A name cannot contain any of < > : " / \\ | ? *.');
    expect(api.rename).not.toHaveBeenCalled();
  });

  it("A2 refuses moving a folder into itself from the Move action without a file-system call", async () => {
    api.list.mockImplementation(async (path: string) =>
      path === ROOT ? listing(ROOT, [folder("lib")]) : listing(path, []),
    );
    tauri.pickFolder.mockResolvedValue("C:\\proj\\lib\\sub");
    renderOps(makeEditor());
    await flush();

    await userEvent.click(screen.getByTitle("C:\\proj\\lib"));
    await userEvent.click(screen.getByRole("button", { name: "Move" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/moved into itself/));
    expect(api.move).not.toHaveBeenCalled();
  });
});

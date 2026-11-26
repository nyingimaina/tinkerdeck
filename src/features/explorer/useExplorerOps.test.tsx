import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExplorerEntry, ExplorerOp } from "../../api/explorer";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  drives: vi.fn(),
  home: vi.fn(),
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

import { useExplorerOps, type ExplorerEditorBridge } from "./useExplorerOps";
import type { ExplorerController } from "./useExplorer";

const ROOT = "C:\\proj";
const file = (name = "a.txt", dir = ROOT): ExplorerEntry => ({ name, path: `${dir}\\${name}`, isDir: false, locked: false });
const folder = (name = "lib", dir = ROOT): ExplorerEntry => ({ name, path: `${dir}\\${name}`, isDir: true, locked: false });
const op = (path: string, extra: Partial<ExplorerOp> = {}): ExplorerOp => ({ path, repaths: [], closed: [], ...extra });

const makeExplorer = () => {
  const reloadFolder = vi.fn();
  const forgetUnder = vi.fn();
  return { controller: { reloadFolder, forgetUnder } as unknown as ExplorerController, reloadFolder, forgetUnder };
};
const makeEditor = (): ExplorerEditorBridge => ({
  flushPending: vi.fn(async () => undefined),
  applyRepaths: vi.fn(),
  applyClosed: vi.fn(),
  dirtyTitlesUnder: vi.fn(() => []),
});

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  tauri.pickFolder.mockReset();
  tauri.pickFolder.mockResolvedValue(null);
});

describe("useExplorerOps file operations (R9)", () => {
  it("R9 creates a file through the one API path and reloads only that folder", async () => {
    const { controller, reloadFolder } = makeExplorer();
    api.create.mockResolvedValue("C:\\proj\\new.txt");
    const { result } = renderHook(() => useExplorerOps({ explorer: controller, editor: makeEditor() }));

    act(() => result.current.createFile(ROOT));
    expect(result.current.prompt).toMatchObject({ kind: "create", parent: ROOT, item: "file" });

    await act(async () => result.current.submit("new.txt"));

    expect(api.create).toHaveBeenCalledWith(ROOT, "new.txt", "file");
    expect(reloadFolder).toHaveBeenCalledWith(ROOT);
    expect(result.current.prompt).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("R9 creates a folder through the same API path", async () => {
    const { controller } = makeExplorer();
    api.create.mockResolvedValue("C:\\proj\\src");
    const { result } = renderHook(() => useExplorerOps({ explorer: controller, editor: makeEditor() }));

    act(() => result.current.createFolder(ROOT));
    await act(async () => result.current.submit("src"));

    expect(api.create).toHaveBeenCalledWith(ROOT, "src", "folder");
  });

  it("R9 re-points the open tabs, forgets the old subtree and reloads the folder after a rename", async () => {
    const { controller, reloadFolder, forgetUnder } = makeExplorer();
    const repaths = [{ id: "d1", path: "C:\\proj\\b.txt", title: "b.txt" }];
    api.rename.mockResolvedValue(op("C:\\proj\\b.txt", { repaths }));
    const editor = makeEditor();
    const { result } = renderHook(() => useExplorerOps({ explorer: controller, editor }));

    act(() => result.current.rename(file("a.txt")));
    await act(async () => result.current.submit("b.txt"));

    expect(api.rename).toHaveBeenCalledWith("C:\\proj\\a.txt", "b.txt");
    expect(editor.applyRepaths).toHaveBeenCalledWith(repaths);
    expect(forgetUnder).toHaveBeenCalledWith("C:\\proj\\a.txt");
    expect(reloadFolder).toHaveBeenCalledWith(ROOT);
  });

  it("R9 reports a committed change after a rename so a stale selection can be dropped", async () => {
    const { controller } = makeExplorer();
    api.rename.mockResolvedValue(op("C:\\proj\\b.txt"));
    const onCommitted = vi.fn();
    const { result } = renderHook(() =>
      useExplorerOps({ explorer: controller, editor: makeEditor(), onCommitted }),
    );

    act(() => result.current.rename(file("a.txt")));
    await act(async () => result.current.submit("b.txt"));

    expect(onCommitted).toHaveBeenCalledTimes(1);
  });

  it("R9 does not report a committed change after a create or a refused rename", async () => {
    const { controller } = makeExplorer();
    api.create.mockResolvedValue("C:\\proj\\new.txt");
    api.rename.mockRejectedValue('"a.txt" already exists in this folder.');
    const onCommitted = vi.fn();
    const { result } = renderHook(() =>
      useExplorerOps({ explorer: controller, editor: makeEditor(), onCommitted }),
    );

    act(() => result.current.createFile(ROOT));
    await act(async () => result.current.submit("new.txt"));
    act(() => result.current.rename(file("a.txt")));
    await act(async () => result.current.submit("a.txt"));

    expect(result.current.error).toContain("already exists");
    expect(onCommitted).not.toHaveBeenCalled();
  });

  it("R9 re-points every open file under a renamed folder", async () => {
    const { controller } = makeExplorer();
    const repaths = [
      { id: "d1", path: "C:\\proj\\lib2\\a.ts", title: "a.ts" },
      { id: "d2", path: "C:\\proj\\lib2\\b.ts", title: "b.ts" },
    ];
    api.rename.mockResolvedValue(op("C:\\proj\\lib2", { repaths }));
    const editor = makeEditor();
    const { result } = renderHook(() => useExplorerOps({ explorer: controller, editor }));

    act(() => result.current.rename(folder("lib")));
    await act(async () => result.current.submit("lib2"));

    expect(editor.applyRepaths).toHaveBeenCalledWith(repaths);
  });

  it("R9 waits for pending typing before deleting, then applies the closed tabs and reloads", async () => {
    const { controller, reloadFolder, forgetUnder } = makeExplorer();
    const editor = makeEditor();
    const order: string[] = [];
    (editor.flushPending as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      order.push("flush");
    });
    api.remove.mockImplementation(async () => {
      order.push("remove");
      return op("C:\\proj\\a.txt", { closed: ["d1"] });
    });
    const { result } = renderHook(() => useExplorerOps({ explorer: controller, editor }));

    act(() => result.current.remove(file("a.txt")));
    expect(result.current.prompt).toMatchObject({ kind: "delete" });
    await act(async () => result.current.submit(""));

    expect(order).toEqual(["flush", "remove"]);
    expect(editor.applyClosed).toHaveBeenCalledWith(["d1"]);
    expect(forgetUnder).toHaveBeenCalledWith("C:\\proj\\a.txt");
    expect(reloadFolder).toHaveBeenCalledWith(ROOT);
  });

  it("R9 folds the unsaved titles into the one delete prompt", () => {
    const { controller } = makeExplorer();
    const editor = makeEditor();
    (editor.dirtyTitlesUnder as ReturnType<typeof vi.fn>).mockReturnValue(["a.txt", "notes.md"]);
    const { result } = renderHook(() => useExplorerOps({ explorer: controller, editor }));

    act(() => result.current.remove(file("a.txt")));

    expect(editor.dirtyTitlesUnder).toHaveBeenCalledWith("C:\\proj\\a.txt");
    expect(result.current.prompt).toMatchObject({ kind: "delete", dirtyTitles: ["a.txt", "notes.md"] });
  });

  it("R9 cancelling a delete changes nothing", () => {
    const { controller } = makeExplorer();
    const { result } = renderHook(() => useExplorerOps({ explorer: controller, editor: makeEditor() }));

    act(() => result.current.remove(file("a.txt")));
    act(() => result.current.cancel());

    expect(result.current.prompt).toBeNull();
    expect(api.remove).not.toHaveBeenCalled();
  });

  it("R9 moves a file with the explicit Move action and the folder picker", async () => {
    const { controller } = makeExplorer();
    tauri.pickFolder.mockResolvedValue("C:\\proj\\lib");
    api.move.mockResolvedValue(op("C:\\proj\\lib\\a.txt"));
    const { result } = renderHook(() => useExplorerOps({ explorer: controller, editor: makeEditor() }));

    act(() => result.current.move(file("a.txt")));

    await waitFor(() => expect(api.move).toHaveBeenCalledWith("C:\\proj\\a.txt", "C:\\proj\\lib"));
  });

  it("R9 moving into another folder re-points the tabs and reloads both levels", async () => {
    const { controller, reloadFolder } = makeExplorer();
    const repaths = [{ id: "d1", path: "C:\\proj\\lib\\a.txt", title: "a.txt" }];
    api.move.mockResolvedValue(op("C:\\proj\\lib\\a.txt", { repaths }));
    const editor = makeEditor();
    const { result } = renderHook(() => useExplorerOps({ explorer: controller, editor }));

    await act(async () => result.current.drop(file("a.txt"), "C:\\proj\\lib"));

    expect(editor.applyRepaths).toHaveBeenCalledWith(repaths);
    expect(reloadFolder).toHaveBeenCalledWith(ROOT);
    expect(reloadFolder).toHaveBeenCalledWith("C:\\proj\\lib");
  });

  it("R9 dropping an item onto the folder it is already in changes nothing", () => {
    const { controller } = makeExplorer();
    const { result } = renderHook(() => useExplorerOps({ explorer: controller, editor: makeEditor() }));

    act(() => result.current.drop(file("a.txt"), ROOT));

    expect(api.move).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  it("R9 refuses to move a folder into itself or one of its descendants before any call", () => {
    const { controller } = makeExplorer();
    const { result } = renderHook(() => useExplorerOps({ explorer: controller, editor: makeEditor() }));

    act(() => result.current.drop(folder("lib"), "C:\\proj\\lib\\sub"));

    expect(api.move).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/moved into itself/);
  });

  it("R9 refuses a Move picked into the folder itself without a file-system call", async () => {
    const { controller } = makeExplorer();
    tauri.pickFolder.mockResolvedValue("C:\\proj\\lib\\sub");
    const { result } = renderHook(() => useExplorerOps({ explorer: controller, editor: makeEditor() }));

    act(() => result.current.move(folder("lib")));

    await waitFor(() => expect(result.current.error).toMatch(/moved into itself/));
    expect(api.move).not.toHaveBeenCalled();
  });
});

describe("useExplorerOps busy and failure states (A1)", () => {
  it("R9 shows a busy state and ignores a second operation while one runs", async () => {
    const { controller } = makeExplorer();
    let release: (path: string) => void = () => {};
    api.create.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const { result } = renderHook(() => useExplorerOps({ explorer: controller, editor: makeEditor() }));

    act(() => result.current.createFile(ROOT));
    act(() => {
      void result.current.submit("new.txt");
    });
    expect(result.current.busy).toBe(true);
    expect(result.current.prompt).toBeNull();

    // A second click while the first is in flight opens no new prompt and runs nothing.
    act(() => result.current.createFile(ROOT));
    expect(result.current.prompt).toBeNull();

    await act(async () => {
      release("C:\\proj\\new.txt");
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(api.create).toHaveBeenCalledTimes(1);
  });

  it("R9 a refused operation shows the message and reloads the folder from disk", async () => {
    const { controller, reloadFolder } = makeExplorer();
    api.create.mockRejectedValue('"new.txt" already exists in this folder.');
    const { result } = renderHook(() => useExplorerOps({ explorer: controller, editor: makeEditor() }));

    act(() => result.current.createFile(ROOT));
    await act(async () => result.current.submit("new.txt"));

    expect(result.current.error).toContain("already exists");
    expect(reloadFolder).toHaveBeenCalledWith(ROOT);
    expect(result.current.busy).toBe(false);
  });

  it("R9 dismisses the error message", async () => {
    const { controller } = makeExplorer();
    api.create.mockRejectedValue("denied");
    const { result } = renderHook(() => useExplorerOps({ explorer: controller, editor: makeEditor() }));

    act(() => result.current.createFile(ROOT));
    await act(async () => result.current.submit("x.txt"));
    expect(result.current.error).toBe("denied");

    act(() => result.current.dismissError());
    expect(result.current.error).toBeNull();
  });

  it("R9 offers no file operations without the editor bridge", () => {
    const { controller } = makeExplorer();
    const { result } = renderHook(() => useExplorerOps({ explorer: controller }));

    act(() => result.current.createFile(ROOT));
    act(() => result.current.rename(file("a.txt")));
    act(() => result.current.remove(file("a.txt")));

    expect(result.current.prompt).toBeNull();
  });
});

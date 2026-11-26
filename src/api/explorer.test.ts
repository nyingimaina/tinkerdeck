import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { explorerApi, type ExplorerEntry, type ExplorerListing, type ExplorerOp } from "./explorer";

const emptyListing = (path: string): ExplorerListing => ({ path, entries: [], total: 0, truncated: false, locked: false });
const op = (path: string): ExplorerOp => ({ path, repaths: [], closed: [] });

beforeEach(() => invoke.mockReset());

describe("explorerApi", () => {
  it("R2 lists one level through explorer_list, passing the folder and camelCase showHidden", async () => {
    const listing = emptyListing("C:\\work\\proj");
    invoke.mockResolvedValue(listing);

    await expect(explorerApi.list("C:\\work\\proj", true)).resolves.toEqual(listing);
    expect(invoke).toHaveBeenCalledWith("explorer_list", { path: "C:\\work\\proj", showHidden: true });
  });

  it("R2 asks for the same folder with showHidden off when hidden names are hidden", async () => {
    invoke.mockResolvedValue(emptyListing("C:\\work\\proj"));

    await explorerApi.list("C:\\work\\proj", false);
    expect(invoke).toHaveBeenCalledWith("explorer_list", { path: "C:\\work\\proj", showHidden: false });
  });

  it("R5 lists the drive roots through explorer_drives", async () => {
    const drives: ExplorerEntry[] = [{ name: "C:", path: "C:\\", isDir: true, locked: false }];
    invoke.mockResolvedValue(drives);

    await expect(explorerApi.drives()).resolves.toEqual(drives);
    expect(invoke).toHaveBeenCalledWith("explorer_drives");
  });

  it("A1 asks the core for the home folder through explorer_home", async () => {
    invoke.mockResolvedValue("C:\\Users\\me");

    await expect(explorerApi.home()).resolves.toBe("C:\\Users\\me");
    expect(invoke).toHaveBeenCalledWith("explorer_home");
  });

  it("A1 returns null when the core cannot determine a home folder", async () => {
    invoke.mockResolvedValue(null);

    await expect(explorerApi.home()).resolves.toBeNull();
    expect(invoke).toHaveBeenCalledWith("explorer_home");
  });

  it("R9 creates a file or folder through explorer_create with the parent, name and kind", async () => {
    invoke.mockResolvedValue("C:\\work\\proj\\new.txt");

    await expect(explorerApi.create("C:\\work\\proj", "new.txt", "file")).resolves.toBe("C:\\work\\proj\\new.txt");
    expect(invoke).toHaveBeenCalledWith("explorer_create", {
      path: "C:\\work\\proj",
      name: "new.txt",
      kind: "file",
    });

    invoke.mockResolvedValue("C:\\work\\proj\\src");
    await explorerApi.create("C:\\work\\proj", "src", "folder");
    expect(invoke).toHaveBeenLastCalledWith("explorer_create", {
      path: "C:\\work\\proj",
      name: "src",
      kind: "folder",
    });
  });

  it("R9 renames through explorer_rename with the item path and new name, returning the re-pointed tabs", async () => {
    const result: ExplorerOp = { path: "C:\\work\\proj\\b.txt", repaths: [{ id: "d1", path: "C:\\work\\proj\\b.txt", title: "b.txt" }], closed: [] };
    invoke.mockResolvedValue(result);

    await expect(explorerApi.rename("C:\\work\\proj\\a.txt", "b.txt")).resolves.toEqual(result);
    expect(invoke).toHaveBeenCalledWith("explorer_rename", { path: "C:\\work\\proj\\a.txt", name: "b.txt" });
  });

  it("R9 moves through explorer_move with the item path and destination folder", async () => {
    const result = op("C:\\work\\proj\\lib\\a.txt");
    invoke.mockResolvedValue(result);

    await expect(explorerApi.move("C:\\work\\proj\\a.txt", "C:\\work\\proj\\lib")).resolves.toEqual(result);
    expect(invoke).toHaveBeenCalledWith("explorer_move", {
      path: "C:\\work\\proj\\a.txt",
      into: "C:\\work\\proj\\lib",
    });
  });

  it("R9 deletes through explorer_delete, returning the tabs it closed", async () => {
    const result: ExplorerOp = { path: "C:\\work\\proj\\a.txt", repaths: [], closed: ["d1"] };
    invoke.mockResolvedValue(result);

    await expect(explorerApi.remove("C:\\work\\proj\\a.txt")).resolves.toEqual(result);
    expect(invoke).toHaveBeenCalledWith("explorer_delete", { path: "C:\\work\\proj\\a.txt" });
  });
});
